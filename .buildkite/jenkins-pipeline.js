import { readFileSync } from "fs";
import * as converter from "./converter.js";

const username = process.env.JENKINS_USERNAME;
const password = process.env.JENKINS_PASSWORD;
const jenkinsUrl = process.env.JENKINS_URL;

if (!username || !password || !jenkinsUrl) {
    console.error("Missing username, token, or Jenkins URL.")
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

    return await response.json();
}
  
convert("../Jenkinsfile")
    .then(json => {
        if (json.data.result === "failure") {
            json.data.errors.map(err => console.error(err.error.join("\n")));
            process.exit(1);
        }

        const pipeline = converter.jenkinsToBuildkite(json.data.json);
        console.log(JSON.stringify(pipeline, null, 4));
    })
    .catch(err => console.error("Conversion failed:", err.message));
