#!/bin/bash

set -e

# Install Java 17.
yum update -y
rpm --import https://yum.corretto.aws/corretto.key
curl -Lo /etc/yum.repos.d/corretto.repo https://yum.corretto.aws/corretto.repo
yum install -y java-17-amazon-corretto

# Create the Jenkins agent directory.
mkdir -p /home/ec2-user/jenkins-agent
chown -R ec2-user:ec2-user /home/ec2-user/jenkins-agent

# Create .ssh and add public key.
mkdir -p /home/ec2-user/.ssh
cat <<EOF >> /home/ec2-user/.ssh/authorized_keys
{{jenkins-public-key}}
EOF

chown -R ec2-user:ec2-user /home/ec2-user/.ssh
chmod 700 /home/ec2-user/.ssh
chmod 600 /home/ec2-user/.ssh/authorized_keys
