#!/bin/bash

set -e

# Install Jenkins and Java
yum update -y
wget -O /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/redhat-stable/jenkins.repo
rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key
yum install -y java-17-amazon-corretto jenkins

# Start Jenkins temporarily (it will create needed directories)
systemctl start jenkins

# Wait a moment for Jenkins to initialize
sleep 10

# Create plugins directory if it doesn't exist and set permissions
mkdir -p /var/lib/jenkins/plugins
chown jenkins:jenkins /var/lib/jenkins/plugins
chmod 755 /var/lib/jenkins/plugins

# Download the plugin manager
echo "Downloading Jenkins plugin manager..."
wget "https://github.com/jenkinsci/plugin-installation-manager-tool/releases/download/2.12.13/jenkins-plugin-manager-2.12.13.jar" -O /tmp/jenkins-plugin-manager.jar

# Install Jenkins plugins
echo "Installing Jenkins plugins..."
java -jar /tmp/jenkins-plugin-manager.jar --war /usr/share/java/jenkins.war -d /var/lib/jenkins/plugins --plugins credentials:latest ssh-credentials:latest plain-credentials:latest ssh-slaves:latest

# Give Jenkins ownership of the plugins
chown -R jenkins:jenkins /var/lib/jenkins/plugins

# Install CloudWatch agent
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

mkdir -p /var/log/jenkins
nohup journalctl -u jenkins -f > /var/log/jenkins/jenkins.log &

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

# Install SSH key for controller
mkdir -p /root/.ssh
chmod 700 /root/.ssh

cat <<'EOF' > /root/.ssh/id_rsa
{{jenkins-private-key}}
EOF

chmod 600 /root/.ssh/id_rsa

# Add Groovy init script for agent setup
mkdir -p /var/lib/jenkins/init.groovy.d

cat <<'EOF' > /var/lib/jenkins/init.groovy.d/bootstrap.groovy
{{bootstrap-groovy}}
EOF

chown -R jenkins:jenkins /var/lib/jenkins/init.groovy.d

# Restart Jenkins to apply plugin changes
systemctl restart jenkins