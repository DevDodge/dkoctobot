import { getCredentialData, getCredentialParam, refreshOAuth2Token } from '../../../src/utils'
import { createGoogleSheetsSearchTool } from './core'
import type { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'

class GoogleSheetsSearch_Tools implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    description: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Google Sheets Search'
        this.name = 'googleSheetsSearchTool'
        this.version = 1.0
        this.type = 'GoogleSheetsSearch'
        this.icon = 'google-sheets.svg'
        this.category = 'Tools'
        this.description = 'Search for rows in a Google Sheet by matching values in specified columns'
        this.baseClasses = ['Tool']
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['googleSheetsOAuth2']
        }
        this.inputs = [
            {
                label: 'Spreadsheet ID',
                name: 'spreadsheetId',
                type: 'string',
                description: 'The ID of the Google Spreadsheet (from the URL)',
                placeholder: 'e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
            },
            {
                label: 'Sheet Name',
                name: 'sheetName',
                type: 'string',
                description: 'The name of the sheet/tab to search in',
                placeholder: 'e.g. Sheet1',
                default: 'Sheet1'
            },
            {
                label: 'Search Columns',
                name: 'searchColumns',
                type: 'string',
                description: 'Comma-separated column letters (A, B, C) or header names (Name, Email) to search in',
                placeholder: 'e.g. A,B or Name,Email'
            },
            {
                label: 'Search Mode',
                name: 'searchMode',
                type: 'options',
                description: 'How to match the search value against cell values',
                options: [
                    {
                        label: 'Exact Match (case-insensitive)',
                        name: 'exact'
                    },
                    {
                        label: 'Contains',
                        name: 'contains'
                    },
                    {
                        label: 'Starts With',
                        name: 'startsWith'
                    },
                    {
                        label: 'Ends With',
                        name: 'endsWith'
                    },
                    {
                        label: 'Greater Than (numeric)',
                        name: 'greaterThan'
                    },
                    {
                        label: 'Less Than (numeric)',
                        name: 'lessThan'
                    },
                    {
                        label: 'Greater Than or Equal (numeric)',
                        name: 'greaterThanOrEqual'
                    },
                    {
                        label: 'Less Than or Equal (numeric)',
                        name: 'lessThanOrEqual'
                    }
                ],
                default: 'contains'
            },
            {
                label: 'First Row is Header',
                name: 'headerRow',
                type: 'boolean',
                description: 'Whether the first row contains column headers (used to label results)',
                default: true,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Max Results',
                name: 'maxResults',
                type: 'number',
                description: 'Maximum number of matching rows to return',
                default: 50,
                optional: true,
                additionalParams: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        let credentialData = await getCredentialData(nodeData.credential ?? '', options)
        credentialData = await refreshOAuth2Token(nodeData.credential ?? '', credentialData, options)
        const accessToken = getCredentialParam('access_token', credentialData, nodeData)

        if (!accessToken) {
            throw new Error('No access token found in credential')
        }

        const spreadsheetId = nodeData.inputs?.spreadsheetId as string
        const sheetName = (nodeData.inputs?.sheetName as string) || 'Sheet1'
        const searchColumns = nodeData.inputs?.searchColumns as string
        const searchMode = (nodeData.inputs?.searchMode as string) || 'contains'
        const headerRow = nodeData.inputs?.headerRow !== false
        const maxResults = (nodeData.inputs?.maxResults as number) || 50

        if (!spreadsheetId) {
            throw new Error('Spreadsheet ID is required')
        }
        if (!searchColumns) {
            throw new Error('Search Columns is required')
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
                maxResults
            }
        })

        return tools
    }
}

module.exports = { nodeClass: GoogleSheetsSearch_Tools }
