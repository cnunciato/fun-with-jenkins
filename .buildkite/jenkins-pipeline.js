import { readFileSync } from "fs";
import * as converter from "./converter.js";

const username = process.env.JENKINS_USERNAME || "admin";
const password = process.env.JENKINS_PASSWORD;
const jenkinsUrl = process.env.JENKINS_URL || "http://localhost:8080/";
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
        json.data.errors.map(err => console.error(err.error.join("\n")));
        process.exit(1);
    }

    return converter.jenkinsToBuildkite(json.data.json);
}
  
convert(jenkinsFile)
    .then(result => console.log(JSON.stringify(result, null, 4)))
    .catch(err => console.error("Conversion failed:", err.message));
