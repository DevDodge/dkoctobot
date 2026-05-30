import { INodeParams, INodeCredential } from "../src/Interface";

class OctobotApi implements INodeCredential {
  label: string;
  name: string;
  version: number;
  inputs: INodeParams[];

  constructor() {
    this.label = "Octobot Gateway API";
    this.name = "octobotApi";
    this.version = 1.0;
    this.inputs = [
      {
        label: "API Key",
        name: "octobotApiKey",
        type: "password",
        placeholder: "sk-...",
        description: "Your Octobot Gateway API key",
      },
    ];
  }
}

module.exports = { credClass: OctobotApi };
