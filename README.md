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

Paste the password into the UI, choose Install Suggested Plugins, and you're good to go. 🎉

You can also use the `plugins.txt` file to specify any additional plugins you'd Jenkins to install automatically at startup using Jenkins [configuration-as-code](https://plugins.jenkins.io/configuration-as-code/).

## Converting a Jenkinsfile into a Buildkite pipeline 🪁

This repo also demonstrates how to convert a Jenkins pipeline into a Buildkite pipeline programmatically.

The Node.js script in the `.buildkite` folder, `jenkins-pipeline.js`, is capable of converting a `Jenkinsfile` into Buildkite pipeline JSON. By default, it looks for a `Jenkinsfile` in the root of the repository. Given the following `Jenkinsfile`, for example:

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

The script would produce the following Buildkite pipeline JSON:

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

Assuming you have Jenkins running locally (e.g., under `docker-compose` as above), you can run script manually by setting a few required environment variables, replacing `JENKINS_PASSWORD` with the one in your `docker-compose` logs:

```bash
export JENKINS_USERNAME="admin"
export JENKINS_PASSWORD="6a62ece5bcf04bb89e937cae3ee1c830"
export JENKINS_URL="http://localhost:8080/"
```

And then:

```bash
npm -C .buildkite install
npm -C .buildkite --silent run jenkins-pipeline
```

### How does it work?

The script uses Jenkins itself (specifically the [Declarative Pipeline plugin](https://plugins.jenkins.io/pipeline-model-definition/)) to convert a declarative `Jenkinsfile` into a JSON structure that Jenkins uses to model pipelines internally, then transforms that structure into a Buildkite pipeline definition. It does this by calling Jenkins's internal `pipeline-model-converter` endpoint:

```
POST /pipeline-model-converter/toJson
```

This endpoint is typically used for [pipeline validation](https://www.jenkins.io/doc/book/pipeline/development/#linter), but it can be used just as easily for converting `Jenkinsfile`s into Buildkite pipelines. ✨

You can call the `pipeline-model-converter` endpoint directly with `curl` if you like:

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

The `converter` module code-generated using on the [Buildkite pipeline](https://github.com/buildkite/pipeline-schema/blob/main/schema.json) and [Jenkins declarative pipeline](https://github.com/jenkinsci/pipeline-model-definition-plugin/blob/master/EXTENDING.md) JSON schemas, the latter retrievable directly from Jenkins with the `pipeline-model-schema` endpoint:

```bash
curl -s -X GET \
  -u "${JENKINS_USERNAME}:${JENKINS_PASSWORD}" \
  -F "jenkinsfile=<Jenkinsfile" \
  "${JENKINS_URL}/pipeline-model-schema/json"
```

Both JSON schemas are included for reference in the `.buildkite` folder. More Jenkins pipeline examples are available in the official [Jenkins pipeline examples](https://github.com/jenkinsci/pipeline-examples/tree/master) repository.

### Doing it live 🚀

Thanks to the magic of [dynamic pipelines](https://buildkite.com/docs/pipelines/configure/dynamic-pipelines), we can combine all this goodness to generate a Buildkite pipeline at runtime using only a `Jenkinsfile`. 

Commits to the `main` branch of this repo do exactly this, converting the steps defined in the `Jenkinsfile` into a set of Buildkite steps -- effectively allowing you to derive a Buildkite pipeline (or a portion of it) from a `Jenkinsfile`:

![A Buildkite pipeline generated from a Jenkinsfile](https://github.com/user-attachments/assets/ba5d79b2-ed85-47bf-b56e-f99598f47312)

![The corrsponding run](https://github.com/user-attachments/assets/310aa889-f4fa-408a-b540-28dcc075cb48)

Commits trigger side-by-side builds in both Buildkite and the Jenkins, both linked from the GitHub checks associated with each one.

The environment variables used in the pipeline script (the username, password, and Jenkins server URL mentioned above) are set in the Buildkite root pipeline in the Steps field:

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

The pipeline model JSON schema is available as well at:

```bash
curl -s -X GET \
  -u "${JENKINS_USERNAME}:${JENKINS_PASSWORD}" \
  -F "jenkinsfile=<Jenkinsfile" \
  "${JENKINS_URL}/pipeline-model-schema/json"
```

### Why is this interesting?

As a proof-of-concept, this script probably doesn't handle _everything_ that can be done with a declarative `Jenkinsfile` -- for example, it doesn't yet handle conditional logic. But the approach is nevertheless a powerful one in that it lets you:

* Bootstrap the conversion of a single Jenkins pipeline quickly and easily, making post-hoc adjustments to the rendered Buildkite pipeline as necessary
* Convert large numbers of Jenkins pipelines more easily by relying on Jenkins's own internal data structures (as opposed to human-authored Jenkinsfiles) and encapsulating the logic of conversion for reuse across an organization 
* Migrate to Buildkite safely and gradually by running both Jenkins and Buildkite side-by-side against the same codebases

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
