import { readFileSync } from "fs";
import * as converter from "./converter.js";
import * as yaml from "js-yaml";

const username = process.env.JENKINS_USERNAME || "admin";
const password = process.env.JENKINS_PASSWORD;
const jenkinsUrl = process.env.JENKINS_URL || "http://localhost:8080/";
const outputFormat = process.env.OUTPUT_FORMAT || "yaml";
const jenkinsFile = process.argv[2] || "../Jenkinsfile";

if (!password) {
    console.error("Missing JENKINS_PASSWORD.")
    process.exit(1);
}

async function convert(jenkinsfile) {
    const file = readFileSync(jenkinsfile, "utf8");
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const form = new FormData();
    form.append("jenkinsfile", file);

    const response = await fetch(`${jenkinsUrl}/pipeline-model-converter/toJson`, {
        method: "POST",
        body: form,
        headers: {
            "Authorization": `Basic ${auth}`,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const json = await response.json();

    if (json.data.result === "failure") {
        console.error(`Errors encountered converting ${jenkinsFile}:`);
        const errors = json.data.errors.at(0).error;
        const messages = Array.isArray(errors) ? errors : [errors];

        console.error(messages.map(m => `* ${m}`).join("\n"));
        process.exit(1);
    }

    return converter.jenkinsToBuildkite(json.data.json);
}
  
convert(jenkinsFile)
    .then(result => {

        // By default, the converter assigns an `agents` prop of `queue: 'default'`, 
        // which for my pipeline doesn't work. (I don't have a queue named 'default'). 
        // So I'll just quietly remove that.
        delete result.agents;
        
        if (outputFormat === "json") {
            console.log(JSON.stringify(result, null, 4))
        } else {
            console.log(yaml.dump(result));
        }
    })
    .catch(err => console.error("Conversion failed:", err.message));
