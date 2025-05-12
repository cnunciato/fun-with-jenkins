import jenkins.model.*
import hudson.security.*
import hudson.slaves.*
import hudson.plugins.sshslaves.*
import hudson.plugins.sshslaves.verifiers.NonVerifyingKeyVerificationStrategy
import hudson.util.Secret
import com.cloudbees.plugins.credentials.*
import com.cloudbees.plugins.credentials.domains.*
import com.cloudbees.jenkins.plugins.sshcredentials.impl.BasicSSHUserPrivateKey
import com.cloudbees.jenkins.plugins.sshcredentials.impl.BasicSSHUserPrivateKey.DirectEntryPrivateKeySource

println "--> Bootstrap Groovy Script: Initializing Jenkins configuration."

// Create the Jenkins admin account.
def instance = Jenkins.getInstance()
def securityRealm = instance.getSecurityRealm()
def admin = securityRealm.createAccount("{{admin-username}}", "{{admin-password}}")
admin.save()

// Don't use the root/controller node as an executor.
instance.setNumExecutors(0)

// Create the SSH credentials for agent communication.
def privateKey = '''{{jenkins-private-key}}'''.stripIndent()
def credentialsId = "ec2-user-key"
def existing = SystemCredentialsProvider.getInstance().getCredentials().find {
    it instanceof BasicSSHUserPrivateKey && it.id == credentialsId
}

if (!existing) {
    def privateKeySource = new BasicSSHUserPrivateKey.DirectEntryPrivateKeySource(privateKey)
    def sshCredentials = new BasicSSHUserPrivateKey( CredentialsScope.GLOBAL, credentialsId, "ec2-user", privateKeySource, null, "Jenkins EC2 User Key")
    
    SystemCredentialsProvider.getInstance().getCredentials().add(sshCredentials)
    SystemCredentialsProvider.getInstance().save()

    println "--> SSH credentials added."
} else {
    println "--> SSH credentials already exist."
}

// Add agents
def agentIps = [{{agent-private-ips}}]

agentIps.eachWithIndex { ip, index ->
    def nodeName = "agent-${index + 1}"

    if (instance.getNode(nodeName) != null) {
        println "--> Node ${nodeName} already exists."
        return
    }

    // Disable host verification.
    def sshHostKeyVerificationStrategy = new NonVerifyingKeyVerificationStrategy()

    def launcher = new SSHLauncher( ip, 22, credentialsId, null, null, null, null, 60, 3, 15, sshHostKeyVerificationStrategy)
    def node = new DumbSlave( nodeName, "/home/ec2-user/jenkins-agent", launcher)

    node.numExecutors = 1
    node.labelString = "linux"
    node.mode = hudson.model.Node.Mode.NORMAL

    instance.addNode(node)
    println "--> Node ${nodeName} added."
}

instance.save()
println "--> Jenkins configuration bootstrap complete."
