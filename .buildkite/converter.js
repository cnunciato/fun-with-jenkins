/**
 * Jenkins to Buildkite Pipeline Converter
 * 
 * Converts a Jenkins declarative pipeline in JSON format to a Buildkite pipeline JSON.
 */

// Helper to extract raw argument value
function extractValue(arg) {
    if (!arg) return null;
    
    // For raw arguments
    if (arg.isLiteral !== undefined) {
        return arg.value;
    }
    
    // For object reference or other complex values
    if (arg.value && arg.value.isLiteral !== undefined) {
        return arg.value.value;
    }
    
    return null;
}

// Helper to convert Jenkins agent to Buildkite agent
function convertAgent(jenkinsAgent) {
    if (!jenkinsAgent) return {};
    
    // Handle "none" agent
    if (jenkinsAgent.type === "none") {
        return { queue: "default" };
    }
    
    const buildkiteAgent = {};
    
    // Handle various agent types
    switch (jenkinsAgent.type) {
        case "any":
            buildkiteAgent.queue = "default";
            break;
        
        case "label":
            if (jenkinsAgent.argument) {
                buildkiteAgent.queue = extractValue(jenkinsAgent.argument);
            }
            break;
            
        case "docker":
            // Map Docker agent to Buildkite Docker plugin
            // In Buildkite, this would be handled via plugins
            buildkiteAgent.queue = "docker";
            break;
            
        case "kubernetes":
            // Map Kubernetes agent to Buildkite k8s
            buildkiteAgent.queue = "kubernetes";
            break;
            
        default:
            // Custom agents or other types
            if (jenkinsAgent.arguments) {
                const keyValues = jenkinsAgent.arguments.filter(arg => arg.key && arg.value);
                keyValues.forEach(kv => {
                    buildkiteAgent[kv.key] = extractValue(kv.value);
                });
            }
    }
    
    return buildkiteAgent;
}

// Helper to convert Jenkins environment variables to Buildkite env
function convertEnvironment(jenkinsEnv) {
    if (!jenkinsEnv || !jenkinsEnv.length) return {};
    
    const buildkiteEnv = {};
    
    jenkinsEnv.forEach(entry => {
        if (entry.key && entry.value) {
            const value = extractValue(entry.value);
            if (value !== null) {
                buildkiteEnv[entry.key] = value;
            }
        }
    });
    
    return buildkiteEnv;
}

// Helper to convert Jenkins steps to Buildkite steps
function convertSteps(jenkinsSteps) {
    if (!jenkinsSteps || !jenkinsSteps.length) return [];
    
    const buildkiteSteps = [];
    
    jenkinsSteps.forEach(step => {
        const newStep = convertStep(step);
        if (newStep) {
            buildkiteSteps.push(newStep);
        }
    });
    
    return buildkiteSteps;
}

// Helper to convert a single Jenkins step to a Buildkite step
function convertStep(jenkinsStep) {
    if (!jenkinsStep || !jenkinsStep.name) return null;
    
    // Map common Jenkins steps to Buildkite equivalents
    switch (jenkinsStep.name) {
        case "sh":
            // Shell command step
            const command = extractCommandArgument(jenkinsStep.arguments);
            if (command) {
                return {
                    command: command
                };
            }
            break;
            
        case "echo":
            // Echo step - map to command with echo
            const message = extractCommandArgument(jenkinsStep.arguments);
            if (message) {
                return {
                    command: `echo "${message}"`
                };
            }
            break;
            
        case "checkout":
            // In Buildkite, checkout is automatic, but we can add custom checkout logic
            return {
                command: "buildkite-agent checkout"
            };
            
        case "dir":
            // Directory change - in Buildkite this is part of the command
            const dir = extractCommandArgument(jenkinsStep.arguments);
            if (dir && jenkinsStep.children) {
                const nestedSteps = convertSteps(jenkinsStep.children);
                // Convert nested steps to commands and prefix with cd
                const commands = nestedSteps
                    .filter(s => s.command)
                    .map(s => s.command);
                
                if (commands.length) {
                    return {
                        command: [
                            `cd ${dir}`,
                            ...commands.flat()
                        ]
                    };
                }
            }
            break;
            
        case "withEnv":
            // Environment variables for a block of steps
            if (jenkinsStep.children) {
                const envVars = extractEnvVarsFromWithEnv(jenkinsStep.arguments);
                const nestedSteps = convertSteps(jenkinsStep.children);
                
                // In Buildkite, we can add env to each step
                return nestedSteps.map(step => ({
                    ...step,
                    env: { ...step.env, ...envVars }
                }));
            }
            break;
            
        case "stage":
            // Stage in Jenkins becomes a group or key/label in Buildkite
            const stageName = jenkinsStep.name === "stage" && jenkinsStep.arguments ? 
                extractCommandArgument(jenkinsStep.arguments) : 
                jenkinsStep.name;
            
            if (jenkinsStep.children) {
                const stageSteps = convertSteps(jenkinsStep.children);
                if (stageSteps.length) {
                    // If there"s only one step and it"s a command, add a label
                    if (stageSteps.length === 1 && stageSteps[0].command) {
                        return {
                            ...stageSteps[0],
                            label: stageName
                        };
                    } else {
                        // Multiple steps - use a group
                        return {
                            group: stageName,
                            steps: stageSteps.flat()
                        };
                    }
                }
            }
            break;
            
        case "parallel":
            // Parallel steps
            if (jenkinsStep.children) {
                const parallelSteps = convertSteps(jenkinsStep.children);
                if (parallelSteps.length) {
                    return parallelSteps;
                }
            }
            break;
            
        case "waitUntil":
        case "retry":
            // These would need special handling in Buildkite
            if (jenkinsStep.children) {
                const childSteps = convertSteps(jenkinsStep.children);
                // Just return the child steps without the retry/wait logic
                // as this would need to be implemented differently in Buildkite
                return childSteps;
            }
            break;
            
        case "script":
            // Script block - contains arbitrary Groovy in Jenkins
            // In Buildkite we just convert this to a shell command
            return {
                command: "# Script block from Jenkins - may need manual conversion"
            };
            
        case "input":
            // Input step becomes a block step in Buildkite
            const promptMessage = extractCommandArgument(jenkinsStep.arguments) || "Waiting for input";
            return {
                block: promptMessage
            };
            
        default:
            // For unknown steps, try to convert as a plugin or command
            // Check if this might be a plugin in Jenkins
            if (jenkinsStep.arguments) {
                const args = Array.isArray(jenkinsStep.arguments) ? 
                    jenkinsStep.arguments.map(arg => extractValue(arg)).filter(Boolean) : 
                    [extractValue(jenkinsStep.arguments)];
                
                if (args.length) {
                    return {
                        plugins: [{
                            [`${jenkinsStep.name}#v1.0.0`]: {
                                // Pass the extracted arguments
                                parameters: args.join(" ")
                            }
                        }]
                    };
                }
            }
            
            // Fall back to command with comment
            return {
                command: `# Jenkins step "${jenkinsStep.name}" - requires manual conversion`
            };
    }
    
    return null;
}

// Extract command argument from Jenkins step arguments
function extractCommandArgument(args) {
    if (!args) return null;
    
    // Handle single argument case
    if (!Array.isArray(args)) {
        return extractValue(args);
    }
    
    // Handle positional arguments
    if (args.length > 0) {
        return extractValue(args[0]);
    }
    
    return null;
}

// Extract environment variables from a withEnv step
function extractEnvVarsFromWithEnv(args) {
    const envVars = {};
    
    if (!args || !args.length) return envVars;
    
    // withEnv takes a list of ENV=VALUE strings
    const envList = Array.isArray(args) ? 
        args.map(arg => extractValue(arg)).filter(Boolean) : 
        [extractValue(args)];
    
    envList.forEach(envStr => {
        if (typeof envStr === "string") {
            const match = envStr.match(/^([^=]+)=(.*)$/);
            if (match) {
                envVars[match[1]] = match[2];
            }
        }
    });
    
    return envVars;
}

// Convert a complete Jenkins pipeline to Buildkite
function convertPipeline(jenkinsPipeline) {
    if (!jenkinsPipeline || !jenkinsPipeline.pipeline) {
        throw new Error("Invalid Jenkins pipeline structure");
    }
    
    const pipeline = jenkinsPipeline.pipeline;
    const buildkitePipeline = {
        steps: []
    };
    
    // Convert top-level agent
    if (pipeline.agent) {
        buildkitePipeline.agents = convertAgent(pipeline.agent);
    }
    
    // Convert environment variables
    if (pipeline.environment) {
        buildkitePipeline.env = convertEnvironment(pipeline.environment);
    }
    
    // Process all stages
    if (pipeline.stages && pipeline.stages.length) {
        pipeline.stages.forEach(stage => {
            processStage(stage, buildkitePipeline);
        });
    }
    
    // Process post-build actions
    if (pipeline.post && pipeline.post.conditions) {
        processPostConditions(pipeline.post.conditions, buildkitePipeline);
    }
    
    return buildkitePipeline;
}

// Process a Jenkins stage
function processStage(jenkinsStage, buildkitePipeline) {
    if (!jenkinsStage || !jenkinsStage.name) return;
    
    // Check for parallel stages
    if (jenkinsStage.parallel && jenkinsStage.parallel.length) {
        // Add a wait step before parallel stages
        buildkitePipeline.steps.push("wait");
        
        // Process each parallel stage
        const parallelSteps = [];
        jenkinsStage.parallel.forEach(parallelStage => {
            const stageSteps = [];
            processStageContent(parallelStage, stageSteps);
            
            if (stageSteps.length) {
                // In Buildkite, we can use a group for each parallel stage
                parallelSteps.push({
                    group: parallelStage.name,
                    steps: stageSteps
                });
            }
        });
        
        // Add all parallel steps
        if (parallelSteps.length) {
            buildkitePipeline.steps.push(...parallelSteps);
        }
        
        // Add a wait step after parallel stages
        buildkitePipeline.steps.push("wait");
        return;
    }
    
    // For regular stages
    const stageSteps = [];
    
    // Process the stage content
    processStageContent(jenkinsStage, stageSteps);
    
    // Add the stage steps to the pipeline
    if (stageSteps.length) {
        // For a single step in the stage, we can just label it
        if (stageSteps.length === 1 && !stageSteps[0].group) {
            stageSteps[0].label = `${jenkinsStage.name}: ${stageSteps[0].label || ""}`.trim();
            buildkitePipeline.steps.push(stageSteps[0]);
        } else {
            // Multiple steps, group them
            buildkitePipeline.steps.push({
                group: jenkinsStage.name,
                steps: stageSteps
            });
        }
    }
}

// Process the content of a stage
function processStageContent(jenkinsStage, stageSteps) {
    // Add stage-specific agent
    let stageAgent = {};
    if (jenkinsStage.agent) {
        stageAgent = convertAgent(jenkinsStage.agent);
    }
    
    // Add stage-specific environment
    let stageEnv = {};
    if (jenkinsStage.environment) {
        stageEnv = convertEnvironment(jenkinsStage.environment);
    }
    
    // Process stage steps
    if (jenkinsStage.branches && jenkinsStage.branches.length) {
        // Find the main branch (usually "default")
        const mainBranch = jenkinsStage.branches.find(branch => 
            branch.name === "default" || branch.name === "main");
        
        if (mainBranch && mainBranch.steps) {
            const steps = convertSteps(mainBranch.steps);
            
            // Apply stage agent and env to each step
            steps.forEach(step => {
                if (Object.keys(stageAgent).length) {
                    step.agents = { ...step.agents, ...stageAgent };
                }
                
                if (Object.keys(stageEnv).length) {
                    step.env = { ...step.env, ...stageEnv };
                }
            });
            
            stageSteps.push(...steps);
        }
    }
    
    // Handle when conditions
    if (jenkinsStage.when && jenkinsStage.when.conditions) {
        // In Buildkite, we can use "if" conditions on steps
        // This is a simplification as Jenkins when conditions can be complex
        const comment = {
            command: "# Jenkins stage had conditional execution - review manually"
        };
        stageSteps.unshift(comment);
    }
    
    // Handle stage input
    if (jenkinsStage.input) {
        const message = jenkinsStage.input.message ? 
            extractValue(jenkinsStage.input.message) : 
            `Confirm ${jenkinsStage.name}`;
        
        const blockStep = {
            block: message
        };
        
        // Add fields if parameters are defined
        if (jenkinsStage.input.parameters && 
                jenkinsStage.input.parameters.parameters && 
                jenkinsStage.input.parameters.parameters.length) {
            
            blockStep.fields = jenkinsStage.input.parameters.parameters.map(param => {
                // Attempt to convert different parameter types
                const paramName = param.arguments && param.arguments.length ? 
                    extractValue(param.arguments[0]) : 
                    "parameter";
                
                // This is a simplification - proper field mapping would be more complex
                return {
                    text: paramName,
                    key: paramName.toLowerCase().replace(/\s+/g, "-")
                };
            });
        }
        
        stageSteps.unshift(blockStep);
    }
    
    // Handle post stage actions
    if (jenkinsStage.post && jenkinsStage.post.conditions) {
        processPostConditions(jenkinsStage.post.conditions, { steps: stageSteps });
    }
}

// Process post-build conditions
function processPostConditions(conditions, targetPipeline) {
    if (!conditions || !conditions.length) return;
    
    // Map of Jenkins post condition to Buildkite soft_fail or similar concepts
    const conditionMap = {
        "success": { comment: "# Post-success actions" },
        "always": { comment: "# Post-always actions" },
        "failure": { comment: "# Post-failure actions", soft_fail: true },
        "aborted": { comment: "# Post-aborted actions" },
        "unstable": { comment: "# Post-unstable actions" }
    };
    
    conditions.forEach(condition => {
        if (condition.condition && condition.branch && condition.branch.steps) {
            const conditionSettings = conditionMap[condition.condition] || 
                                                             { comment: `# Post-${condition.condition} actions` };
            
            // Convert the steps
            const postSteps = convertSteps(condition.branch.steps);
            
            // Add condition-specific properties to steps
            postSteps.forEach(step => {
                if (conditionSettings.soft_fail && step.command) {
                    step.soft_fail = true;
                }
                
                // Add any other condition-specific configurations
                Object.keys(conditionSettings).forEach(key => {
                    if (key !== "comment" && key !== "soft_fail") {
                        step[key] = conditionSettings[key];
                    }
                });
            });
            
            // Add a comment step to indicate post condition
            if (conditionSettings.comment) {
                postSteps.unshift({
                    command: conditionSettings.comment
                });
            }
            
            // Add to the pipeline
            targetPipeline.steps.push(...postSteps);
        }
    });
}

/**
 * Main function to convert a Jenkins pipeline JSON to Buildkite pipeline JSON
 * @param {Object} jenkinsJSON - Jenkins pipeline in JSON format
 * @returns {Object} Buildkite pipeline in JSON format
 */
function jenkinsToBuildkite(jenkinsJSON) {
    try {
        return convertPipeline(jenkinsJSON);
    } catch (error) {
        console.error("Error converting pipeline:", error);
        throw error;
    }
}

// Export functions using ES modules syntax
export {
    jenkinsToBuildkite as convertJenkinsToBuildkite,
    convertPipeline,
    convertStep,
    convertSteps,
    convertAgent,
    convertEnvironment
};

// Default export for the main function
export default jenkinsToBuildkite;