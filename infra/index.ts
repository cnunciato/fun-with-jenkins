// index.ts
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";

const config = new pulumi.Config();
const instanceType = config.get("instanceType") || "t3.micro";
const serverPort = config.getNumber("serverPort") || 8080;
const vpcNetworkCidr = config.get("vpcNetworkCidr") || "10.0.0.0/16";
const numAgents = config.getNumber("numAgents") || 5;
const adminPassword = config.requireSecret("adminPassword");

const privateKey = fs.readFileSync("jenkins-key", "utf-8").trim();
const publicKey = fs.readFileSync("jenkins-key.pub", "utf-8").trim();
const controllerScript = fs.readFileSync("userdata-controller.sh", "utf-8");
const agentScript = fs.readFileSync("userdata-agent.sh", "utf-8");

const ami = aws.ec2.getAmi({
    filters: [{ name: "name", values: ["amzn2-ami-hvm-*"] }],
    owners: ["amazon"],
    mostRecent: true,
}).then(ami => ami.id);

const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: vpcNetworkCidr,
    enableDnsHostnames: true,
    enableDnsSupport: true,
});

const gateway = new aws.ec2.InternetGateway("gateway", { vpcId: vpc.id });

const subnet = new aws.ec2.Subnet("subnet", {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",
    mapPublicIpOnLaunch: true,
});

const routeTable = new aws.ec2.RouteTable("route-table", {
    vpcId: vpc.id,
    routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: gateway.id }],
});

new aws.ec2.RouteTableAssociation("route-table-association", {
    subnetId: subnet.id,
    routeTableId: routeTable.id,
});

const securityGroup = new aws.ec2.SecurityGroup("security-group", {
    description: "Enable SSH and HTTP access",
    vpcId: vpc.id,
    ingress: [
        { fromPort: serverPort, toPort: serverPort, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] },
        { fromPort: 22, toPort: 22, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] },
    ],
    egress: [
        { fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] },
    ],
});

const cloudwatchRole = new aws.iam.Role("cloudwatch-role", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ec2.amazonaws.com" }),
});

new aws.iam.RolePolicyAttachment("cloudwatch-role-policy-attachment", {
    role: cloudwatchRole.name,
    policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
});

const instanceProfile = new aws.iam.InstanceProfile("instance-profile", {
    role: cloudwatchRole.name,
});

const systemLogGroup = new aws.cloudwatch.LogGroup("system-log-group");
const jenkinsLogGroup = new aws.cloudwatch.LogGroup("jenkins-log-group");

const agents: aws.ec2.Instance[] = [];
const agentIps: pulumi.Output<string>[] = [];

for (let i = 0; i < numAgents; i++) {
    const agentUserData = agentScript.replace("{{jenkins-public-key}}", publicKey);

    const agent = new aws.ec2.Instance(`jenkins-agent-${i}`, {
        ami: ami,
        instanceType: instanceType,
        iamInstanceProfile: instanceProfile.name,
        vpcSecurityGroupIds: [securityGroup.id],
        subnetId: subnet.id,
        userData: agentUserData,
        tags: {
            Name: `jenkins-agent-${i + 1}`,
        },
  });

  agents.push(agent);
  agentIps.push(agent.privateIp);
}

const bootstrapGroovy = pulumi.all([agentIps, adminPassword]).apply(([ips, password]) => {
    const agentList = ips.map(ip => `"${ip}"`).join(", ");
    const template = fs.readFileSync("bootstrap.groovy", "utf-8");
    return template
        .replace("{{jenkins-private-key}}", privateKey)
        .replace("{{agent-private-ips}}", agentList)
        .replace("{{admin-password}}", password);
});

const controllerUserData = pulumi.all([systemLogGroup.name, jenkinsLogGroup.name, bootstrapGroovy]).apply(
    ([systemLogName, jenkinsLogName, groovy]) => {
        return controllerScript
        .replace("{{ec2-system-messages-log}}", systemLogName)
        .replace("{{jenkins-service-log}}", jenkinsLogName)
        .replace("{{jenkins-private-key}}", privateKey)
        .replace("{{bootstrap-groovy}}", groovy);
    }
);

const controller = new aws.ec2.Instance("jenkins-controller", {
    ami: ami,
    instanceType: instanceType,
    iamInstanceProfile: instanceProfile.name,
    vpcSecurityGroupIds: [securityGroup.id],
    subnetId: subnet.id,
    userData: controllerUserData,
    tags: {
        Name: "jenkins-controller",
    },
});

export const controllerIp = controller.publicIp;
export const controllerUrl = pulumi.interpolate`http://${controller.publicDns}:${serverPort}`;
export const exportedAgentIps = agentIps;
