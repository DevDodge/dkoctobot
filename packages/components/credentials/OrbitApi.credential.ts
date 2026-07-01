import { INodeParams, INodeCredential } from "../src/Interface";

class OrbitApi implements INodeCredential {
  label: string;
  name: string;
  version: number;
  inputs: INodeParams[];

  constructor() {
    this.label = "Orbit Provider API";
    this.name = "orbitApi";
    this.version = 1.0;
    this.inputs = [
      {
        label: "API Key",
        name: "orbitApiKey",
        type: "password",
        placeholder: "sk-orbit-...",
        description: "Your Orbit Provider API key",
      },
    ];
  }
}

module.exports = { credClass: OrbitApi };
