import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";

const config = new pulumi.Config();
const instanceType = config.get("instanceType") || "t3.micro";
const serverPort = config.getNumber("serverPort") || 8080;
const vpcNetworkCidr = config.get("vpcNetworkCidr") || "10.0.0.0/16";

// Get the latest Amazon Linux 2 AMI.
const ami = aws.ec2.getAmi({
    filters: [{ name: "name", values: ["amzn2-ami-hvm-*"] }],
    owners: ["amazon"],
    mostRecent: true,
}).then(invoke => invoke.id);

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

const routeTableAssociation = new aws.ec2.RouteTableAssociation("route-table-association", {
    subnetId: subnet.id,
    routeTableId: routeTable.id,
});

const securityGroup = new aws.ec2.SecurityGroup("security-group", {
    description: "Enable HTTP access",
    vpcId: vpc.id,
    ingress: [{
        fromPort: serverPort,
        toPort: serverPort,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
});

// Create an IAM Role for the CloudWatch Agent.
const cloudwatchRole = new aws.iam.Role("cloudwatch-role", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ec2.amazonaws.com" }),
});

const cloudwatchRolePolicyAttachment = new aws.iam.RolePolicyAttachment("cloudwatch-role-policy-attachment", {
    role: cloudwatchRole.name,
    policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
});

const instanceProfile = new aws.iam.InstanceProfile("instance-profile", {
    role: cloudwatchRole.name,
});

const systemLogGroup = new aws.cloudwatch.LogGroup("system-log-group");
const jenkinsLogGroup = new aws.cloudwatch.LogGroup("jenkins-log-group");
const userData = fs.readFileSync("userdata.sh", "utf-8");

// Create an instance for the Jenkins server.
const instance = new aws.ec2.Instance("instance", {
    ami: ami,
    instanceType: instanceType,
    iamInstanceProfile: instanceProfile.name,
    vpcSecurityGroupIds: [securityGroup.id],
    subnetId: subnet.id,
    userData: pulumi.all([systemLogGroup.name, jenkinsLogGroup.name]).apply(([systemLogName, jenkinsLogName]) => {
        return userData
            .replace("{{ec2-system-messages-log}}", systemLogName)
            .replace("{{jenkins-service-log}}", jenkinsLogName);
    }),
});

export const ip = instance.publicIp;
export const hostname = instance.publicDns;
export const url = pulumi.interpolate`http://${instance.publicDns}:${serverPort}`;
