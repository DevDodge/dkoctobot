import {
  getCredentialData,
  getCredentialParam,
  refreshOAuth2Token,
} from "../../../src/utils";
import {
  createGoogleSheetsSearchTool,
  createGetLastRowTool,
  createNextRecordNumberTool,
} from "./core";
import type {
  ICommonObject,
  INode,
  INodeData,
  INodeParams,
} from "../../../src/Interface";

class GoogleSheetUtils_Tools implements INode {
  label: string;
  name: string;
  version: number;
  type: string;
  icon: string;
  category: string;
  description: string;
  baseClasses: string[];
  credential: INodeParams;
  inputs: INodeParams[];

  constructor() {
    this.label = "Google Sheet Utils";
    this.name = "googleSheetUtilsTool";
    this.version = 1.0;
    this.type = "GoogleSheetUtils";
    this.icon = "google-sheets.svg";
    this.category = "Tools";
    this.description =
      "Google Sheet utilities: search rows (search_google_sheet), get last row number (get_last_row), get next record number (get_next_record_number)";
    this.baseClasses = ["Tool"];
    this.credential = {
      label: "Connect Credential",
      name: "credential",
      type: "credential",
      credentialNames: ["googleSheetsOAuth2", "googleSheetsServiceAccount"],
    };
    this.inputs = [
      {
        label: "Utility Type",
        name: "utilityType",
        type: "options",
        description:
          "The utility to use. Available tools: search_google_sheet (search rows), get_last_row (get last row number), get_next_record_number (get next record number after last one)",
        options: [
          {
            label: "Search",
            name: "search",
            description:
              "Search for rows by matching values in specified columns. Tool name: search_google_sheet",
          },
          {
            label: "Get Last Row",
            name: "getLastRow",
            description:
              "Get the row number of the last row that contains data. Tool name: get_last_row",
          },
          {
            label: "Next Record Number",
            name: "nextRecordNumber",
            description:
              "Get the number of the next new record (last row + 1). Tool name: get_next_record_number",
          },
        ],
        default: "search",
      },
      {
        label: "Spreadsheet ID",
        name: "spreadsheetId",
        type: "string",
        description: "The ID of the Google Spreadsheet (from the URL)",
        placeholder: "e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      },
      {
        label: "Sheet Name",
        name: "sheetName",
        type: "string",
        description: "The name of the sheet/tab",
        placeholder: "e.g. Sheet1",
        default: "Sheet1",
      },
      {
        label: "Search Columns",
        name: "searchColumns",
        type: "string",
        description:
          "Comma-separated column letters (A, B, C) or header names (Name, Email) to search in",
        placeholder: "e.g. A,B or Name,Email",
        show: {
          utilityType: ["search"],
        },
      },
      {
        label: "Search Mode",
        name: "searchMode",
        type: "options",
        description: "How to match the search value against cell values",
        options: [
          {
            label: "Exact Match (case-insensitive)",
            name: "exact",
          },
          {
            label: "Contains",
            name: "contains",
          },
          {
            label: "Starts With",
            name: "startsWith",
          },
          {
            label: "Ends With",
            name: "endsWith",
          },
          {
            label: "Greater Than (numeric)",
            name: "greaterThan",
          },
          {
            label: "Less Than (numeric)",
            name: "lessThan",
          },
          {
            label: "Greater Than or Equal (numeric)",
            name: "greaterThanOrEqual",
          },
          {
            label: "Less Than or Equal (numeric)",
            name: "lessThanOrEqual",
          },
        ],
        default: "contains",
        show: {
          utilityType: ["search"],
        },
      },
      {
        label: "First Row is Header",
        name: "headerRow",
        type: "boolean",
        description:
          "Whether the first row contains column headers (used to label results)",
        default: true,
        optional: true,
        additionalParams: true,
        show: {
          utilityType: ["search"],
        },
      },
      {
        label: "Max Results",
        name: "maxResults",
        type: "number",
        description: "Maximum number of matching rows to return",
        default: 50,
        optional: true,
        additionalParams: true,
        show: {
          utilityType: ["search"],
        },
      },
    ];
  }

  async init(
    nodeData: INodeData,
    _: string,
    options: ICommonObject
  ): Promise<any> {
    let credentialData = await getCredentialData(
      nodeData.credential ?? "",
      options
    );

    let accessToken: string;

    // Check credential type by checking for serviceAccountKey field
    if (credentialData.serviceAccountKey) {
      // Service Account authentication using jose (Node.js v24 compatible)
      const { SignJWT, importPKCS8 } = await import('jose');
      const axios = (await import('axios')).default;

      const serviceAccountKey = credentialData.serviceAccountKey;

      const keyData = typeof serviceAccountKey === 'string'
        ? JSON.parse(serviceAccountKey)
        : serviceAccountKey;

      // Extract service account details
      const { client_email, private_key } = keyData;

      if (!client_email || !private_key) {
        throw new Error('Service account key must contain client_email and private_key');
      }

      // Create JWT claims
      const now = Math.floor(Date.now() / 1000);
      const jwtClaims = {
        iss: client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
      };

      // Import the private key (replace escaped newlines with actual newlines)
      const formattedPrivateKey = private_key.replace(/\\n/g, '\n');
      const privateKeyObj = await importPKCS8(formattedPrivateKey, 'RS256');

      // Sign the JWT
      const jwt = await new SignJWT(jwtClaims)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .sign(privateKeyObj);

      // Exchange JWT for access token
      const tokenResponse = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );

      accessToken = tokenResponse.data.access_token;
    } else {
      // OAuth2 authentication
      credentialData = await refreshOAuth2Token(
        nodeData.credential ?? "",
        credentialData,
        options
      );
      accessToken = getCredentialParam(
        "access_token",
        credentialData,
        nodeData
      );
    }

    if (!accessToken) {
      throw new Error("No access token found in credential");
    }

    const utilityType = (nodeData.inputs?.utilityType as string) || "search";
    const spreadsheetId = nodeData.inputs?.spreadsheetId as string;
    const sheetName = (nodeData.inputs?.sheetName as string) || "Sheet1";

    if (!spreadsheetId) {
      throw new Error("Spreadsheet ID is required");
    }

    if (utilityType === "getLastRow") {
      return createGetLastRowTool({ accessToken, spreadsheetId, sheetName });
    }

    if (utilityType === "nextRecordNumber") {
      return createNextRecordNumberTool({
        accessToken,
        spreadsheetId,
        sheetName,
      });
    }

    // Default: search
    const searchColumns = nodeData.inputs?.searchColumns as string;
    const searchMode = (nodeData.inputs?.searchMode as string) || "contains";
    const headerRow = nodeData.inputs?.headerRow !== false;
    const maxResults = (nodeData.inputs?.maxResults as number) || 50;

    if (!searchColumns) {
      throw new Error("Search Columns is required");
    }

    const tools = createGoogleSheetsSearchTool({
      accessToken,
      config: {
        accessToken,
        spreadsheetId,
        sheetName,
        searchColumns,
        searchMode,
        headerRow,
        maxResults,
      },
    });

    return tools;
  }
}

module.exports = { nodeClass: GoogleSheetUtils_Tools };
