#!/bin/bash

set -e

# Install Jenkins
yum update -y
wget -O /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/redhat-stable/jenkins.repo
rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key
# yum upgrade -y
yum install java-17-amazon-corretto jenkins -y

# Enable Jenkins.
systemctl enable jenkins
systemctl start jenkins

# Install and configure the CloudWatch Agent.
yum install -y amazon-cloudwatch-agent

cat <<EOF > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/messages",
            "log_group_name": "{{ec2-system-messages-log}}",
            "log_stream_name": "{instance_id}",
            "timestamp_format": "%b %d %H:%M:%S"
          },
          {
            "file_path": "/var/log/jenkins/jenkins.log",
            "log_group_name": "{{jenkins-service-log}}",
            "log_stream_name": "{instance_id}",
            "timestamp_format": "%Y-%m-%d %H:%M:%S"
          }
        ]
      }
    }
  }
}
EOF

# Start logging Jenkins service output.
mkdir -p /var/log/jenkins
nohup journalctl -u jenkins -f > /var/log/jenkins/jenkins.log &

# Start the CloudWatch Agent.
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

# Create .ssh directory
mkdir -p /root/.ssh
chmod 700 /root/.ssh

# Install private key
cat <<'EOF' > /root/.ssh/id_rsa
{{jenkins-private-key}}
EOF

chmod 600 /root/.ssh/id_rsa

cat /root/.ssh/id_rsa
