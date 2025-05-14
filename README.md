# fun-with-jenkins

[![Build status](https://badge.buildkite.com/41540f18af5fa6a63abe00a854bfe22f7a1a0131210f7c08a4.svg)](https://buildkite.com/cnunciato/fun-with-jenkins)

This is just me getting familiar with Jenkins.

## Running Jenkins locally with Docker Compose

To spin up a lightweight Jenkins cluster locally with Docker, make sure Docker Desktop is running, then run:

```bash
docker-compose up
```

... and browse to the server at http://localhost:8080.

At first launch, you'll be prompted for the initial administrator password. You'll find this in the `docker-compose` logs, which should be visible in your terminal:

```
jenkins-1  | *************************************************************
jenkins-1  | 
jenkins-1  | Jenkins initial setup is required. An admin user has been created and a password generated.
jenkins-1  | Please use the following password to proceed to installation:
jenkins-1  | 
jenkins-1  | 6a62ece5bcf04bb89e937cae3ee1c830
jenkins-1  | 
jenkins-1  | This may also be found at: /var/jenkins_home/secrets/initialAdminPassword
jenkins-1  | 
jenkins-1  | *************************************************************
```

Paste the password into the UI when prompted, choose Install Recommended Plugins, and you're done. 

You can also use the `plugins.txt` file to specify any additional plugins you'd Jenkins to install automatically at startup (using Jenkins [configuration-as-code](https://plugins.jenkins.io/configuration-as-code/)).

## Converting a Jenkinsfile to a Buildkite pipeline ➡️🪁

The `.buildkite` folder contains a Node.js script that converts the `Jenkinsfile` in the root of the repository into a Buildkite pipeline definition. For example, given the following `Jenkinsfile`:

```groovy
pipeline {
    agent any
    stages {
        stage(':jenkins: Hello from the Jenkinsfile!') {
            steps {
                echo 'Hi, world! :wave:'
            }
        }
    }
}
```

The script will produce the following Buildkite pipeline JSON:

```json
{
    "steps": [
        {
            "label": ":jenkins: Hello from the Jenkinsfile!",
            "commands": [
                "echo 'Hi, world! :wave:'"
            ]
        }
    ]
}
```

You can run this script locally by setting a few required environment variables (replacing `JENKINS_PASSWORD` with the one in your `docker-compose` logs):

```bash
export JENKINS_USERNAME="admin"
export JENKINS_PASSWORD="0dcce1b76f944aaea37d114648ef75e6"
export JENKINS_URL="http://localhost:8080/"
```

And then:

```bash
npm -C .buildkite install
npm -C .buildkite --silent run jenkins-pipeline
```

### How does it work?

This script converts a declarative `Jenkinsfile` into its JSON representation (which Jenkins uses internally), then extracts the build steps into a simplified structure. It works by calling Jenkins’s internal Pipeline Model Converter endpoint:

```
POST /pipeline-model-converter/toJson
```

This endpoint is normally used for [pipeline validation](https://www.jenkins.io/doc/book/pipeline/development/#linter), but it can be used just as easily for converting `Jenkinsfile`s into Buildkite pipelines. ✨

You can also call the `pipeline-model-converter` endpoint directly with `curl` if you like:

```bash
curl -s -X POST \
  -u "${JENKINS_USERNAME}:${JENKINS_PASSWORD}" \
  -F "jenkinsfile=<Jenkinsfile" \
  "${JENKINS_URL}/pipeline-model-converter/toJson"
```

Which produces:

```json
{
  "status": "ok",
  "data": {
    "result": "success",
    "json": {
      "pipeline": {
        "stages": [
          {
            "name": ":jenkins: Hello from the Jenkinsfile!",
            "branches": [
              {
                "name": "default",
                "steps": [
                  {
                    "name": "echo",
                    "arguments": [
                      {
                        "key": "message",
                        "value": {
                          "isLiteral": true,
                          "value": "Hi, world! :wave:"
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        "agent": {
          "type": "any"
        }
      }
    }
  }
}
```

### Doing it live 🚀

Thanks to the magic of [dynamic pipelines](https://buildkite.com/docs/pipelines/configure/dynamic-pipelines), you can even generate Buildkite pipelines at runtime, using only a Jenkinsfile, and run Jenkins and Buildkite side-by-side in response to a single commit.

Commits to the `main` branch of this repository do exactly this, extending the Buildkite pipeline at runtime using the contents of the checked-in `Jenkinsfile`:

![A Buildkite pipeline generated from a Jenkinsfile](https://github.com/user-attachments/assets/758e44c0-e506-44d7-9afb-224efcfa5745)

The environment variables required by the pipeline script (username, password, Jenkins server URL) are set in the Buildkite root pipeline (i.e., in the Steps field):

```yaml
steps:
  - label: ":pipeline: Generate pipeline"
    commands:
      # ...

      # Read the username and password from Pulumi config, and get the computed URL from the stack.
      - export JENKINS_USERNAME="$$(pulumi -C infra config get adminUsername --stack dev)"
      - export JENKINS_PASSWORD="$$(pulumi -C infra config get adminPassword --stack dev)"
      - export JENKINS_URL="$$(pulumi -C infra stack output controllerCloudFrontURL --stack dev)"
      
      # Build and upload the pipeline using the supplied Jenkinsfile.
      - npm -C .buildkite install
      - npm -C .buildkite --silent run jenkins-pipeline | buildkite-agent pipeline upload
```

## Deploying Jenkins to EC2

The `infra` folder contains a Pulumi program that deploys a Jenkins cluster to EC2 with a configurable number of agents (all as virtual machines) and an administrator password applied as a Pulumi secret. Logs for the controller are sent to CloudWatch, so can be streamed to the terminal pulled with `pulumi logs`:

```bash
pulumi logs -f
```

```
Collecting logs for stack dev since 2025-05-14T06:15:32.000-07:00.
 2025-05-14T07:13:28.000-07:00[      system-log-group-dae9f00] May 14 14:13:28 ip-10-0-1-52 systemd: Created slice User Slice of jenkins.
 2025-05-14T07:13:28.000-07:00[      system-log-group-dae9f00] May 14 14:13:28 ip-10-0-1-52 systemd: Started Session c268 of user jenkins.
 2025-05-14T07:13:28.000-07:00[      system-log-group-dae9f00] May 14 14:13:28 ip-10-0-1-52 log4j-cve-2021-44228-hotpatch: [log4j-hotpatch] Using Java 17 hotpatch
```
