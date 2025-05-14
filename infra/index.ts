import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";

const config = new pulumi.Config();
const controllerInstanceType = config.get("controllerInstanceType") || "t3.micro";
const agentInstanceType = config.get("agentInstanceType") || "t3.micro";
const controllerPort = config.getNumber("controllerPort") || 8080;
const numberOfAgents = config.getNumber("numberOfAgents") || 1;
const adminUsername = config.require("adminUsername");
const adminPassword = config.requireSecret("adminPassword");
const privateKey = config.requireSecret("privateKey");
const publicKey = config.require("publicKey");

const controllerScript = fs.readFileSync("userdata-controller.sh", "utf-8");
const agentScript = fs.readFileSync("userdata-agent.sh", "utf-8");

const ami = aws.ec2
    .getAmi({
        filters: [{ name: "name", values: ["amzn2-ami-hvm-*"] }],
        owners: ["amazon"],
        mostRecent: true,
    })
    .then(ami => ami.id);

const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsHostnames: true,
    enableDnsSupport: true,
});

const subnet = new aws.ec2.Subnet("subnet", {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",
    mapPublicIpOnLaunch: true,
});

const gateway = new aws.ec2.InternetGateway("gateway", { vpcId: vpc.id });

const routeTable = new aws.ec2.RouteTable("route-table", {
    vpcId: vpc.id,
    routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: gateway.id }],
});

new aws.ec2.RouteTableAssociation("route-table-association", {
    subnetId: subnet.id,
    routeTableId: routeTable.id,
});

const securityGroup = new aws.ec2.SecurityGroup("security-group", {
    vpcId: vpc.id,
    ingress: [
        { 
            fromPort: controllerPort, 
            toPort: controllerPort, 
            protocol: "tcp", 
            cidrBlocks: ["0.0.0.0/0"] 
        },
        { 
            fromPort: 22, 
            toPort: 22, 
            protocol: "tcp", 
            cidrBlocks: ["0.0.0.0/0"] 
        },
    ],
    egress: [
        { 
            fromPort: 0, 
            toPort: 0, 
            protocol: "-1", 
            cidrBlocks: ["0.0.0.0/0"] 
        },
    ],
});

const cloudwatchRole = new aws.iam.Role("cloudwatch-role", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ 
        Service: "ec2.amazonaws.com" 
    }),
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

for (let i = 0; i < numberOfAgents; i++) {
    const agentUserData = agentScript.replace("{{jenkins-public-key}}", publicKey.trim());

    const agent = new aws.ec2.Instance(`jenkins-agent-${i}`, {
        ami: ami,
        instanceType: agentInstanceType,
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

const bootstrapScript = pulumi.all([agentIps, adminPassword, privateKey])
    .apply(([ips, password, key]) => {
        const agentList = ips.map(ip => `"${ip}"`).join(", ");
        const script = fs.readFileSync("bootstrap.groovy", "utf-8");
        return script
            .replace("{{jenkins-private-key}}", key.trim())
            .replace("{{agent-private-ips}}", agentList)
            .replace("{{admin-username}}", adminUsername)
            .replace("{{admin-password}}", password);
    });

const controllerUserData = pulumi.all([systemLogGroup.name, jenkinsLogGroup.name, bootstrapScript, privateKey])
    .apply(([systemLogName, jenkinsLogName, groovy, key]) => {
        return controllerScript
            .replace("{{ec2-system-messages-log}}", systemLogName)
            .replace("{{jenkins-service-log}}", jenkinsLogName)
            .replace("{{jenkins-private-key}}", key.trim())
            .replace("{{bootstrap-groovy}}", groovy);
    });

const controller = new aws.ec2.Instance("jenkins-controller", {
    ami: ami,
    instanceType: controllerInstanceType,
    iamInstanceProfile: instanceProfile.name,
    vpcSecurityGroupIds: [securityGroup.id],
    subnetId: subnet.id,
    userData: controllerUserData,
    tags: {
        Name: "jenkins-controller",
    },
});

const cloudfrontDistribution = new aws.cloudfront.Distribution("jenkins-cdn", {
    enabled: true,
    origins: [
        {
            domainName: controller.publicDns,
            originId: "jenkinsOrigin",
            customOriginConfig: {
                httpPort: controllerPort,
                httpsPort: 443,
                originProtocolPolicy: "http-only",
                originSslProtocols: ["TLSv1.2"],
            },
        },
    ],
    defaultCacheBehavior: {
        targetOriginId: "jenkinsOrigin",
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
        cachedMethods: ["GET", "HEAD"],
        forwardedValues: {
            queryString: true,
            headers: ["*"],
            cookies: { forward: "all" },
        },
        minTtl: 0,
        defaultTtl: 0,
        maxTtl: 0,
    },
    restrictions: {
        geoRestriction: {
            restrictionType: "none",
        },
    },
    viewerCertificate: {
        cloudfrontDefaultCertificate: true,
    },
    isIpv6Enabled: true,
    defaultRootObject: "",
});

export const controllerPublicDNS = pulumi.interpolate`http://${controller.publicDns}:${controllerPort}`;
export const controllerCloudFrontURL = cloudfrontDistribution.domainName.apply(name => `https://${name}`);
export const agentPrivateIPs = agentIps;
