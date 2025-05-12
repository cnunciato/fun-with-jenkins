import { readFileSync } from "fs";

const username = process.env.JENKINS_USERNAME;
const token = process.env.JENKINS_TOKEN;
const jenkinsUrl = process.env.JENKINS_URL;

if (!username || !token || !jenkinsUrl) {
    console.error("Missing username, token, or Jenkins URL.")
    process.exit(1);
}

async function convert(jenkinsfile) {
    const file = readFileSync(jenkinsfile, "utf8");
    const auth = Buffer.from(`${username}:${token}`).toString("base64");

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

function transform(jenkinsJson) {
    const stages = jenkinsJson?.pipeline?.stages || [];
    const steps = [];
  
    for (const stage of stages) {
        const stageName = stage.name;

        for (const branch of stage.branches || []) {
            for (const step of branch.steps || []) {
                const stepName = step.name;
        
                let command = stepName;
        
                if (step.arguments && step.arguments.length > 0) {
                    const args = step.arguments.map(arg => {
                        if (arg.key === "message" && arg.value?.isLiteral) {
                            return `'${arg.value.value}'`;
                        } else {
                            return arg.value?.value || "";
                        }
                    });
        
                    command += " " + args.join(" ");
                }
        
                steps.push({
                    label: stageName,
                    commands: [command]
                });
            }
        }
    }
  
    return { steps };
  }
  

convert("../Jenkinsfile")
    .then(json => {
        const transformed = transform(json.data.json);
        console.log(JSON.stringify(transformed, null, 4));
    })
    .catch(err => console.error("Conversion failed:", err.message));
