import { Tool } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { convertMultiOptionsToStringArray, getBaseClasses } from '../../../src/utils'

const DEFAULT_ERP_URL = 'https://erp.octobot.it.com'

class AppCityRAG_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'AppCity RAG Search'
        this.name = 'appCityRAG'
        this.version = 2.1
        this.type = 'AppCityRAG'
        this.icon = 'appcity-rag.svg'
        this.category = 'AppCity'
        this.description =
            'Search data in CRM data sheets using the AppCity RAG engine. Supports CRM Integration Key (recommended) or direct ERP connection.'
        this.baseClasses = [this.type, 'Tool', ...getBaseClasses(Tool)]
        this.inputs = [
            {
                label: 'ERP Base URL',
                name: 'erpBaseUrl',
                type: 'string',
                default: DEFAULT_ERP_URL,
                description: 'Base URL of the ERP OctoBot gateway (where RAG search runs)'
            },
            {
                label: 'CRM Base URL',
                name: 'crmBaseUrl',
                type: 'string',
                default: 'http://localhost:5000',
                description: 'Base URL of the CRM backend (for sheet permissions & search logging)',
                optional: true,
                additionalParams: true
            },
            {
                label: 'CRM API Key',
                name: 'apiKey',
                type: 'password',
                description:
                    'Integration API key from CRM (Integration Keys page). When set, loads allowed sheets from CRM and logs searches. Leave empty for direct ERP mode.',
                optional: true
            },
            {
                label: 'Data Sheets',
                name: 'selectedSheets',
                type: 'asyncMultiOptions',
                loadMethod: 'listSheets',
                description:
                    'Select the data sheets the agent can search. Selected sheets appear in the system message. Requires CRM API Key or ERP connection.',
                refresh: true
            },
            {
                label: 'Tool Name',
                name: 'toolName',
                type: 'string',
                default: 'search_data',
                description: 'Name the agent will use to call this tool',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Tool Description',
                name: 'toolDescription',
                type: 'string',
                rows: 4,
                default: '',
                description:
                    'Auto-generated from selected sheets. Override to customize. This text tells the agent which sheets it can search and how to use the tool.',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Search Mode',
                name: 'searchMode',
                type: 'options',
                options: [
                    { label: 'All Matches (return all matching rows)', name: 'all_matches' },
                    { label: 'Best Match (return top 3-5 results)', name: 'best_match' }
                ],
                default: 'all_matches',
                description:
                    'all_matches returns every row that matches the query (recommended for data sheets). best_match returns only the top few results ranked by relevance.',
                optional: true,
                additionalParams: true
            }
        ]
    }

    //@ts-ignore
    loadMethods = {
        listSheets: async (nodeData: INodeData, _options: ICommonObject): Promise<INodeOptionsValue[]> => {
            const apiKey = nodeData.inputs?.apiKey as string
            const erpBaseUrl = ((nodeData.inputs?.erpBaseUrl as string) || DEFAULT_ERP_URL).replace(/\/+$/, '')
            const crmBaseUrl = ((nodeData.inputs?.crmBaseUrl as string) || 'http://localhost:5000').replace(/\/+$/, '')

            // ═══════════════════════════════════════════════
            // MODE A: CRM Integration Key — Fetch allowed sheets
            // ═══════════════════════════════════════════════
            if (apiKey) {
                try {
                    const url = `${crmBaseUrl}/api/integration/sheets`
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }
                    })

                    if (!response.ok) {
                        const err = await response.text()
                        let msg = `${response.status}`
                        try {
                            msg = JSON.parse(err).message || msg
                        } catch {
                            /* ignore */
                        }
                        return [{ label: `❌ CRM: ${msg}`, name: 'error', description: 'Check CRM URL and API Key' }]
                    }

                    const result = (await response.json()) as any
                    if (!result.success) {
                        return [{ label: `❌ ${result.message || 'Error'}`, name: 'error' }]
                    }

                    const sheets = result.sheets || []
                    if (sheets.length === 0) {
                        return [
                            {
                                label: `⚠️ ${result.client || 'Client'} — No data sheets configured`,
                                name: 'no_sheets',
                                description: 'Go to CRM → Integration Keys → select this key → Data Sheets → enable the sheets you want.'
                            }
                        ]
                    }

                    // Return sheets as selectable options
                    return sheets.map((sheet: any) => ({
                        label: `📊 ${sheet.name} — ${sheet.rowCount} rows`,
                        name: `${sheet.collectionId}|${sheet.id}|${sheet.name}`,
                        description: sheet.description || `${sheet.rowCount} rows | Last synced: ${sheet.lastSyncedAt || 'N/A'}`
                    }))
                } catch (error: any) {
                    return [
                        {
                            label: '❌ CRM Connection Failed',
                            name: 'error',
                            description: `${error.message}. Check that CRM is running at ${crmBaseUrl}.`
                        }
                    ]
                }
            }

            // ═══════════════════════════════════════════════
            // MODE B: Direct ERP — Fetch all collections
            // ═══════════════════════════════════════════════
            try {
                const url = `${erpBaseUrl}/api/rag/collections`
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                })

                if (!response.ok) {
                    return [
                        {
                            label: `Error: ${response.status} ${response.statusText}`,
                            name: 'error',
                            description: `Failed to connect to ERP at ${erpBaseUrl}.`
                        }
                    ]
                }

                const result = (await response.json()) as any
                if (result.status !== 'ok' || !result.data || result.data.length === 0) {
                    return [
                        {
                            label: 'No collections available',
                            name: 'error',
                            description: 'No RAG collections found. Create one in the ERP dashboard.'
                        }
                    ]
                }

                return result.data.map((collection: any) => {
                    const itemCount = collection._count?.items || 0
                    const workspaceName = collection.workspace?.name || 'Unknown'
                    const clientName = collection.workspace?.client?.name || ''
                    const label = clientName
                        ? `${collection.name} (${clientName}) — ${itemCount} items`
                        : `${collection.name} (${workspaceName}) — ${itemCount} items`

                    return {
                        label,
                        name: `${collection.id}||${collection.name}`,
                        description: collection.description || `${itemCount} items`
                    }
                })
            } catch (error: any) {
                return [
                    {
                        label: 'Connection Error',
                        name: 'error',
                        description: `Failed to connect to ERP: ${error.message}.`
                    }
                ]
            }
        }
    }

    async init(nodeData: INodeData, _: string, _options: ICommonObject): Promise<any> {
        const erpBaseUrl = ((nodeData.inputs?.erpBaseUrl as string) || DEFAULT_ERP_URL).replace(/\/+$/, '')
        const crmBaseUrl = ((nodeData.inputs?.crmBaseUrl as string) || 'http://localhost:5000').replace(/\/+$/, '')
        const apiKey = nodeData.inputs?.apiKey as string
        const toolName = (nodeData.inputs?.toolName as string) || 'search_data'
        let toolDescription = (nodeData.inputs?.toolDescription as string) || ''
        const searchMode = (nodeData.inputs?.searchMode as string) || 'all_matches'

        // Parse selected sheets from multiOptions
        const selectedRaw = convertMultiOptionsToStringArray(nodeData.inputs?.selectedSheets as string)
        const sheets: { collectionId: string; sheetId: number | null; sheetName: string }[] = selectedRaw
            .filter((s) => s && s !== 'error' && s !== 'no_sheets')
            .map((encoded) => {
                const parts = encoded.split('|')
                return {
                    collectionId: parts[0],
                    sheetId: parts[1] ? parseInt(parts[1]) || null : null,
                    sheetName: parts[2] || parts[0]
                }
            })

        if (sheets.length === 0) {
            throw new Error('Please select at least one data sheet. Click the refresh button to load available sheets.')
        }

        // Auto-generate tool description from selected sheets if not manually set
        if (!toolDescription || toolDescription.trim().length === 0) {
            const sheetList = sheets.map((s) => `"${s.sheetName}"`).join(', ')
            toolDescription = `Search for data across the following sheets: ${sheetList}.\n\nUse this tool when the customer asks about information in these sheets — such as products, doctors, offers, branches, prices, availability, schedules, or any related data.\n\nInput format: a JSON string with "sheet" (sheet name) and "query" (search query).\nExample: {"sheet": "${
                sheets[0].sheetName
            }", "query": "dentist"}\n\nAvailable sheets:\n${sheets
                .map((s) => `- ${s.sheetName}`)
                .join(
                    '\n'
                )}\n- AllSheets (searches ALL sheets at once)\n\nAlways specify which sheet to search. If unsure which sheet, use "AllSheets" to search all sheets at once.`
        }

        return new AppCityRAGTool({
            erpBaseUrl,
            crmBaseUrl,
            apiKey: apiKey || null,
            sheets,
            toolName,
            toolDescription,
            searchMode
        })
    }
}

interface SheetConfig {
    collectionId: string
    sheetId: number | null
    sheetName: string
}

interface AppCityRAGToolConfig {
    erpBaseUrl: string
    crmBaseUrl: string
    apiKey: string | null
    sheets: SheetConfig[]
    toolName: string
    toolDescription: string
    searchMode: string
}

class AppCityRAGTool extends Tool {
    name: string
    description: string
    private erpBaseUrl: string
    private crmBaseUrl: string
    private apiKey: string | null
    private sheets: SheetConfig[]
    private searchMode: string

    constructor(config: AppCityRAGToolConfig) {
        super()
        this.name = config.toolName
        this.description = config.toolDescription
        this.erpBaseUrl = config.erpBaseUrl
        this.crmBaseUrl = config.crmBaseUrl
        this.apiKey = config.apiKey
        this.sheets = config.sheets
        this.searchMode = config.searchMode
    }

    async _call(input: string): Promise<string> {
        try {
            const startTime = Date.now()

            // Parse input — expects {"sheet": "name", "query": "search terms"}
            // or just a plain string query (uses first sheet)
            let sheetName: string
            let query: string

            try {
                const parsed = JSON.parse(input)
                sheetName = parsed.sheet || parsed.sheetName || ''
                query = parsed.query || parsed.q || ''
            } catch {
                // Plain text input — try to match a sheet name, or use first sheet
                query = input.trim()
                sheetName = ''
            }

            // ═══════════════════════════════════════════════
            // Check for "All" sheets mode
            // ═══════════════════════════════════════════════
            const ALL_KEYWORDS = ['allsheets', 'all sheets', 'all', 'الكل', 'كلهم', 'جميع', 'كل الشيتات']
            const isAllSheets = sheetName && ALL_KEYWORDS.includes(sheetName.toLowerCase().trim())

            if (isAllSheets && query) {
                return await this.searchAllSheets(query, startTime)
            }

            // Resolve which sheet to search
            let targetSheet: SheetConfig | undefined

            if (sheetName) {
                // Fuzzy match sheet name
                const lower = sheetName.toLowerCase()
                targetSheet = this.sheets.find(
                    (s) =>
                        s.sheetName.toLowerCase() === lower ||
                        s.sheetName.toLowerCase().includes(lower) ||
                        lower.includes(s.sheetName.toLowerCase())
                )
            }

            // If no match and only one sheet, use it
            if (!targetSheet && this.sheets.length === 1) {
                targetSheet = this.sheets[0]
            }

            if (!targetSheet) {
                const available = this.sheets.map((s) => `"${s.sheetName}"`).join(', ')
                return `Please specify which sheet to search. Available sheets: ${available}, or use "AllSheets" to search all sheets.\n\nUse format: {"sheet": "sheet name", "query": "your search"}`
            }

            if (!query) {
                return 'Please provide a search query. Example: {"sheet": "' + targetSheet.sheetName + '", "query": "your search terms"}'
            }

            // ═══════════════════════════════════════════════
            // Call ERP DIRECTLY for speed
            // ═══════════════════════════════════════════════
            const result = await this.searchSingleSheet(targetSheet, query)
            const searchTimeMs = Date.now() - startTime

            if (result.error) {
                return result.error
            }

            // Log to CRM ASYNCHRONOUSLY (fire-and-forget)
            if (this.apiKey) {
                this.logSearchToCRM(query, targetSheet, result.data, searchTimeMs).catch(() => {
                    /* silent */
                })
            }

            return this.formatResults(result.data, query, targetSheet.sheetName)
        } catch (error: any) {
            return `Failed to search: ${error.message}`
        }
    }

    /**
     * Search a single sheet via ERP API
     */
    private async searchSingleSheet(sheet: SheetConfig, query: string): Promise<{ data?: any; error?: string }> {
        try {
            const url = `${this.erpBaseUrl}/api/rag/search`
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    collectionId: sheet.collectionId,
                    query: query.trim(),
                    mode: this.searchMode
                })
            })

            if (!response.ok) {
                const errorText = await response.text()
                return { error: `Error searching "${sheet.sheetName}": ${response.status} ${response.statusText}. ${errorText}` }
            }

            const result = (await response.json()) as any
            if (result.status !== 'ok') {
                return { error: `Search error in "${sheet.sheetName}": ${result.message || 'Unknown error'}` }
            }

            return { data: result }
        } catch (err: any) {
            return { error: `Failed to search "${sheet.sheetName}": ${err.message}` }
        }
    }

    /**
     * Search ALL configured sheets in parallel, merge & rank results
     */
    private async searchAllSheets(query: string, startTime: number): Promise<string> {
        // Fire all searches in parallel
        const searchPromises = this.sheets.map(async (sheet) => {
            const result = await this.searchSingleSheet(sheet, query)
            return { sheet, result }
        })

        const results = await Promise.all(searchPromises)
        const totalTimeMs = Date.now() - startTime

        // Collect all products with their sheet origin
        const allProducts: Array<{ sheetName: string; product: any; score: number }> = []
        const sheetSummaries: string[] = []
        let totalMatched = 0

        for (const { sheet, result } of results) {
            if (result.error || !result.data) {
                sheetSummaries.push(`❌ ${sheet.sheetName}: error`)
                continue
            }

            const products = (result.data.products as any[]) || []
            const matchedCount = products.length || result.data.matchedItemIds?.length || 0
            totalMatched += matchedCount

            if (matchedCount > 0) {
                sheetSummaries.push(`✅ ${sheet.sheetName}: ${matchedCount} results`)
            } else {
                sheetSummaries.push(`⚪ ${sheet.sheetName}: 0 results`)
            }

            for (const p of products) {
                allProducts.push({
                    sheetName: sheet.sheetName,
                    product: p,
                    score: p.score || 0.5
                })
            }

            // Log each sheet search to CRM
            if (this.apiKey) {
                this.logSearchToCRM(query, sheet, result.data, totalTimeMs).catch(() => {})
            }
        }

        // Sort all products by relevance score (highest first)
        allProducts.sort((a, b) => b.score - a.score)

        // Build combined response
        let response = `🔍 Search across ALL sheets (${this.sheets.length} sheets):\n`
        response += sheetSummaries.join('\n') + '\n'
        response += `\n📊 Total: ${totalMatched} results found\n`

        if (allProducts.length > 0) {
            const productList = allProducts
                .map((item, idx) => {
                    const itemData = item.product.data || item.product
                    const fields = Object.entries(itemData)
                        .filter(([key]) => !['id', 'embedding', 'searchText', 'collectionId'].includes(key))
                        .filter(([, value]) => value !== null && value !== undefined && String(value).trim().length > 0)
                        .map(([key, value]) => `  ${key}: ${value}`)
                        .join('\n')
                    const scoreStr = item.score ? ` (match: ${(item.score * 100).toFixed(0)}%)` : ''
                    return `[${idx + 1}] 📋 ${item.sheetName}${scoreStr}\n${fields}`
                })
                .join('\n\n')
            response += `\n${productList}`
        }

        response += `\n\n[Source: ALL_SHEETS | ${totalMatched} results | ${totalTimeMs}ms]`

        return response
    }

    private async logSearchToCRM(query: string, sheet: SheetConfig, result: any, searchTimeMs: number): Promise<void> {
        try {
            await fetch(`${this.crmBaseUrl}/api/integration/search-log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey! },
                body: JSON.stringify({
                    sheet_id: sheet.sheetId,
                    sheet_name: sheet.sheetName,
                    query,
                    results_count: result.products?.length || result.matchedItemIds?.length || 0,
                    source: result.source || 'UNKNOWN',
                    search_time_ms: searchTimeMs
                })
            })
        } catch {
            /* silent */
        }
    }

    private formatResults(result: any, query: string, sheetName: string): string {
        const answer = result.answer
        const products = (result.products as any[]) || []
        const source = result.source || 'unknown'

        if (!answer && products.length === 0) {
            return `No results found for "${query}" in sheet "${sheetName}"`
        }

        let response = `Results from "${sheetName}":\n\n`

        if (answer) {
            response += answer
        }

        if (products.length > 0) {
            const productList = products
                .map((p: any, idx: number) => {
                    const itemData = p.data || p
                    const fields = Object.entries(itemData)
                        .filter(([key]) => !['id', 'embedding', 'searchText', 'collectionId'].includes(key))
                        .filter(([, value]) => value !== null && value !== undefined && String(value).trim().length > 0)
                        .map(([key, value]) => `  ${key}: ${value}`)
                        .join('\n')
                    const scoreStr = p.score ? ` (match: ${(p.score * 100).toFixed(0)}%)` : ''
                    return `[${idx + 1}]${scoreStr}\n${fields}`
                })
                .join('\n\n')
            response += `\n\n${productList}`
        }

        response += `\n\n[Source: ${source} | ${products.length} results${result.cached ? ' (cached)' : ''}${
            result.searchTimeMs ? ` | ${result.searchTimeMs}ms` : ''
        }]`

        return response
    }
}

module.exports = { nodeClass: AppCityRAG_Tools }
