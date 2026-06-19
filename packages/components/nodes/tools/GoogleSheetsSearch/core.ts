import { z } from "zod";
import fetch from "node-fetch";
import { DynamicStructuredTool } from "../OpenAPIToolkit/core";
import { TOOL_ARGS_PREFIX, formatToolError } from "../../../src/agents";

export interface GoogleSheetsSearchConfig {
  accessToken: string;
  spreadsheetId: string;
  sheetName: string;
  searchColumns: string;
  searchMode: string;
  headerRow: boolean;
  maxResults: number;
}

const SearchSchema = z.object({
  searchValue: z
    .string()
    .describe("The value to search for in the configured Google Sheet columns"),
});

/**
 * Convert a column letter (A, B, ..., Z, AA, AB, ...) to a 0-based index
 */
function columnLetterToIndex(letter: string): number {
  let index = 0;
  const upper = letter.toUpperCase().trim();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Resolve which column indices to search based on searchColumns config.
 * Supports both letter-based (A, B, C) and header-name-based (Name, Email) formats.
 */
function resolveColumnIndices(
  searchColumns: string,
  headers: string[] | null
): number[] {
  const parts = searchColumns
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const indices: number[] = [];

  for (const part of parts) {
    // Check if it's a pure column letter (A-ZZ pattern)
    if (/^[A-Za-z]{1,3}$/.test(part) && (!headers || !headers.includes(part))) {
      indices.push(columnLetterToIndex(part));
    } else if (headers) {
      // Try to match by header name (case-insensitive)
      const idx = headers.findIndex(
        (h) => h.toLowerCase() === part.toLowerCase()
      );
      if (idx !== -1) {
        indices.push(idx);
      }
    }
  }

  return indices;
}

/**
 * Check if a cell value matches the search value based on the search mode
 */
function matchesSearchMode(
  cellValue: string,
  searchValue: string,
  searchMode: string
): boolean {
  const cell = (cellValue ?? "").toString();
  const search = searchValue.toString();

  switch (searchMode) {
    case "exact":
      return cell.toLowerCase() === search.toLowerCase();

    case "contains":
      return cell.toLowerCase().includes(search.toLowerCase());

    case "startsWith":
      return cell.toLowerCase().startsWith(search.toLowerCase());

    case "endsWith":
      return cell.toLowerCase().endsWith(search.toLowerCase());

    case "greaterThan": {
      const cellNum = parseFloat(cell);
      const searchNum = parseFloat(search);
      return !isNaN(cellNum) && !isNaN(searchNum) && cellNum > searchNum;
    }

    case "lessThan": {
      const cellNum = parseFloat(cell);
      const searchNum = parseFloat(search);
      return !isNaN(cellNum) && !isNaN(searchNum) && cellNum < searchNum;
    }

    case "greaterThanOrEqual": {
      const cellNum = parseFloat(cell);
      const searchNum = parseFloat(search);
      return !isNaN(cellNum) && !isNaN(searchNum) && cellNum >= searchNum;
    }

    case "lessThanOrEqual": {
      const cellNum = parseFloat(cell);
      const searchNum = parseFloat(search);
      return !isNaN(cellNum) && !isNaN(searchNum) && cellNum <= searchNum;
    }

    default:
      return cell.toLowerCase().includes(search.toLowerCase());
  }
}

class SearchGoogleSheetTool extends DynamicStructuredTool {
  protected accessToken: string;
  private config: GoogleSheetsSearchConfig;

  constructor(args: { accessToken: string; config: GoogleSheetsSearchConfig }) {
    super({
      name: "search_google_sheet",
      description: `Search for rows in a Google Sheet. The spreadsheet, sheet name, columns, and search mode are pre-configured. You only need to provide the search value. Returns matching rows as JSON.`,
      schema: SearchSchema,
      baseUrl: "",
      method: "GET",
      headers: {},
    });
    this.accessToken = args.accessToken;
    this.config = args.config;
  }

  async _call(arg: z.infer<typeof SearchSchema>): Promise<string> {
    const { searchValue } = arg;

    try {
      // 1. Fetch all values from the sheet
      const encodedSheet = encodeURIComponent(this.config.sheetName);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.config.spreadsheetId}/values/${encodedSheet}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Google Sheets API Error ${response.status}: ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as { values?: string[][] };
      const rows = data.values || [];

      if (rows.length === 0) {
        return (
          JSON.stringify({
            results: [],
            message: "Sheet is empty or not found",
          }) +
          TOOL_ARGS_PREFIX +
          JSON.stringify(arg)
        );
      }

      // 2. Parse headers
      let headers: string[] | null = null;
      let dataRows: string[][];

      if (this.config.headerRow) {
        headers = rows[0];
        dataRows = rows.slice(1);
      } else {
        dataRows = rows;
      }

      // 3. Resolve column indices
      const columnIndices = resolveColumnIndices(
        this.config.searchColumns,
        headers
      );

      if (columnIndices.length === 0) {
        return (
          JSON.stringify({
            results: [],
            message: `No valid columns found for search. Configured columns: "${this.config.searchColumns}"`,
          }) +
          TOOL_ARGS_PREFIX +
          JSON.stringify(arg)
        );
      }

      // 4. Filter rows
      const matchingRows: Record<string, string>[] | string[][] = [];

      for (const row of dataRows) {
        const matches = columnIndices.some((colIdx) => {
          const cellValue = colIdx < row.length ? row[colIdx] : "";
          return matchesSearchMode(
            cellValue,
            searchValue,
            this.config.searchMode
          );
        });

        if (matches) {
          if (headers) {
            // Return as object with header keys
            const rowObj: Record<string, string> = {};
            headers.forEach((header, idx) => {
              rowObj[header] = idx < row.length ? row[idx] : "";
            });
            (matchingRows as Record<string, string>[]).push(rowObj);
          } else {
            (matchingRows as string[][]).push(row);
          }

          if (matchingRows.length >= this.config.maxResults) break;
        }
      }

      const result = {
        results: matchingRows,
        totalMatches: matchingRows.length,
        searchValue,
        searchMode: this.config.searchMode,
        searchedColumns: this.config.searchColumns,
      };

      return JSON.stringify(result) + TOOL_ARGS_PREFIX + JSON.stringify(arg);
    } catch (error) {
      return formatToolError(`Error searching Google Sheet: ${error}`, arg);
    }
  }
}

export const createGoogleSheetsSearchTool = (args: {
  accessToken: string;
  config: GoogleSheetsSearchConfig;
}): DynamicStructuredTool[] => {
  return [new SearchGoogleSheetTool(args)];
};

// ==================== Get Last Row Tool ====================

class GetLastRowTool extends DynamicStructuredTool {
  protected accessToken: string;
  private spreadsheetId: string;
  private sheetName: string;

  constructor(args: {
    accessToken: string;
    spreadsheetId: string;
    sheetName: string;
  }) {
    super({
      name: "get_last_row",
      description: `Get the row number of the last row that contains data in the configured Google Sheet. Returns the row number directly. No input is needed.`,
      schema: z.object({}),
      baseUrl: "",
      method: "GET",
      headers: {},
    });
    this.accessToken = args.accessToken;
    this.spreadsheetId = args.spreadsheetId;
    this.sheetName = args.sheetName;
  }

  async _call(): Promise<string> {
    try {
      const encodedSheet = encodeURIComponent(this.sheetName);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodedSheet}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Google Sheets API Error ${response.status}: ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as { values?: string[][] };
      const rows = data.values || [];

      const lastRow = rows.length;

      return JSON.stringify({
        lastRow,
        message: `The last row with data is row number ${lastRow}`,
      });
    } catch (error) {
      return formatToolError(`Error getting last row: ${error}`, {});
    }
  }
}

export const createGetLastRowTool = (args: {
  accessToken: string;
  spreadsheetId: string;
  sheetName: string;
}): DynamicStructuredTool[] => {
  return [new GetLastRowTool(args)];
};

// ==================== Next Record Number Tool ====================

class NextRecordNumberTool extends DynamicStructuredTool {
  protected accessToken: string;
  private spreadsheetId: string;
  private sheetName: string;

  constructor(args: {
    accessToken: string;
    spreadsheetId: string;
    sheetName: string;
  }) {
    super({
      name: "get_next_record_number",
      description: `Get the row number where the next new record should be added in the configured Google Sheet. This is the last row with data + 1. Returns the number directly. No input is needed.`,
      schema: z.object({}),
      baseUrl: "",
      method: "GET",
      headers: {},
    });
    this.accessToken = args.accessToken;
    this.spreadsheetId = args.spreadsheetId;
    this.sheetName = args.sheetName;
  }

  async _call(): Promise<string> {
    try {
      const encodedSheet = encodeURIComponent(this.sheetName);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodedSheet}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Google Sheets API Error ${response.status}: ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as { values?: string[][] };
      const rows = data.values || [];

      const nextRecordNumber = rows.length + 1;

      return JSON.stringify({
        nextRecordNumber,
        message: `The next new record will be row number ${nextRecordNumber}`,
      });
    } catch (error) {
      return formatToolError(`Error getting next record number: ${error}`, {});
    }
  }
}

export const createNextRecordNumberTool = (args: {
  accessToken: string;
  spreadsheetId: string;
  sheetName: string;
}): DynamicStructuredTool[] => {
  return [new NextRecordNumberTool(args)];
};
