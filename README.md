# fun-with-jenkins

[![Build status](https://badge.buildkite.com/41540f18af5fa6a63abe00a854bfe22f7a1a0131210f7c08a4.svg)](https://buildkite.com/cnunciato/fun-with-jenkins)

This is just me getting familiar with Jenkins.

## Running Jenkins locally with Docker Compose

To spin up a quick Jenkins cluster locally with Docker Compose, first make sure Docker Desktop is running, then run:

```bash
docker-compose up
```

... and browse to the server at http://localhost:8080.

Add whatever plugins you like to `plugins.txt` and they'll be installed automatically.

## Converting a Jenkinsfile to a Buildkite pipeline 🪁

The `.buildkite` folder contains a Node.js script that reads the `Jenkinsfile` in the root of this repo, passes it to a Jenkins server (specifically to the [`pipeline-model-converter`](https://chatgpt.com/share/681d35bd-7d10-8012-bb62-56e7b66c1acb) endpoint), and transforms the JSON returned by that endpoint into a Buildkite pipeline definition. Given the following `Jenkinsfile`, for example:

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

The generated pipeline would be:

``` V
$ npm -C .buildkite --silent run build 
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

Commits to the `main` branch of this repo trigger:

* A run of the Jenkins pipeline defined in the `Jenkinsfile`
* A run of the program above, which converts the `Jenkinsfile` into a Buildkite pipeline (at runtime!) and then runs it on Buildkite:

![A Jenkins pipeline run](https://github.com/user-attachments/assets/322e2723-bfdb-48c4-9d42-a49f333751cf)

![A Buildkite pipeline generated from a Jenkinsfile](https://github.com/user-attachments/assets/758e44c0-e506-44d7-9afb-224efcfa5745)


This is just a proof of concept (and only works with declarative pipelines), but it's a neat demonstration of what you can do with dynamic pipelines. (Requires that an API token be created first, then set as a Buildkite cluter secret.)

## Infrastructure 🚧

The `infra` folder contains a Pulumi program (still under construction) that deploys Jenkins on EC2 with a configurable number of agents (all as configurable virtual machines) and an administrator password applied as a Pulumi secret. Logs for the controller are streamed to CloudWatcgh, so can be pulled with `pulumi logs`:

```bash
pulumi logs -f
```
