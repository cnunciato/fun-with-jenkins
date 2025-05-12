import  { Pipeline } from "@buildkite/buildkite-sdk";

const pipeline = new Pipeline();

pipeline.addStep({
    commands: [
        
    ],
});

console.log(pipeline.toJSON());
