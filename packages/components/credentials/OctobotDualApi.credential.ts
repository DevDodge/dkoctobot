import { INodeParams, INodeCredential } from "../src/Interface";

class OctobotDualApi implements INodeCredential {
  label: string;
  name: string;
  version: number;
  inputs: INodeParams[];

  constructor() {
    this.label = "Octobot Gateway Dual API";
    this.name = "octobotDualApi";
    this.version = 1.0;
    this.inputs = [
      {
        label: "Primary API Key",
        name: "octobotPrimaryApiKey",
        type: "password",
        placeholder: "sk-...",
        description:
          "Primary Octobot Gateway API key — used for all requests by default",
      },
      {
        label: "Backup API Key",
        name: "octobotBackupApiKey",
        type: "password",
        placeholder: "sk-... (optional)",
        optional: true,
        description:
          "Backup Octobot Gateway API key — automatically used if the primary key fails",
      },
    ];
  }
}

module.exports = { credClass: OctobotDualApi };
