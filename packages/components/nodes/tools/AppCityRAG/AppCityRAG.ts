import { Tool } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'

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
        this.version = 1.1
        this.type = 'AppCityRAG'
        this.icon = 'appcity-rag.svg'
        this.category = 'AppCity'
        this.description = 'Search products and data in ERP collections using the AppCity RAG engine (Smart Product Search)'
        this.baseClasses = [this.type, 'Tool', ...getBaseClasses(Tool)]
        this.inputs = [
            {
                label: 'ERP Base URL',
                name: 'erpBaseUrl',
                type: 'string',
                default: DEFAULT_ERP_URL,
                description: 'Base URL of the ERP Octobot gateway'
            },
            {
                label: 'Collection',
                name: 'collectionId',
                type: 'asyncOptions',
                loadMethod: 'listCollections',
                description: 'Select a RAG collection to search in. Click the refresh button to load collections from the ERP.',
                refresh: true
            },
            {
                label: 'Tool Name',
                name: 'toolName',
                type: 'string',
                default: 'search_products',
                description: 'Name the agent will use to call this tool',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Tool Description',
                name: 'toolDescription',
                type: 'string',
                rows: 3,
                default:
                    'Search for products, items, or data in the ERP database. Use this tool when the customer asks about products, prices, availability, or any product-related information. Input should be a natural language search query.',
                description: 'Description that helps the agent understand when and how to use this tool',
                optional: true,
                additionalParams: true
            }
        ]
    }

    //@ts-ignore
    loadMethods = {
        listCollections: async (nodeData: INodeData, options: ICommonObject): Promise<INodeOptionsValue[]> => {
            try {
                const erpBaseUrl = ((nodeData.inputs?.erpBaseUrl as string) || DEFAULT_ERP_URL).replace(/\/+$/, '')
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
                            description: `Failed to connect to ERP at ${erpBaseUrl}. Check the URL and try again.`
                        }
                    ]
                }

                const result = (await response.json()) as any

                if (result.status !== 'ok' || !result.data || !Array.isArray(result.data)) {
                    return [
                        {
                            label: 'No collections found',
                            name: 'error',
                            description: 'The ERP returned no collections. Create a collection first in the ERP dashboard.'
                        }
                    ]
                }

                if (result.data.length === 0) {
                    return [
                        {
                            label: 'No collections available',
                            name: 'error',
                            description: 'No RAG collections found. Create one in the ERP dashboard → Smart Product Search.'
                        }
                    ]
                }

                // Map collections to dropdown options
                const items: INodeOptionsValue[] = result.data.map((collection: any) => {
                    const itemCount = collection._count?.items || 0
                    const cacheCount = collection._count?.queryCache || 0
                    const workspaceName = collection.workspace?.name || 'Unknown'
                    const clientName = collection.workspace?.client?.name || ''
                    const label = clientName
                        ? `${collection.name} (${clientName} → ${workspaceName}) — ${itemCount} items`
                        : `${collection.name} (${workspaceName}) — ${itemCount} items`

                    return {
                        label,
                        name: collection.id,
                        description: collection.description || `${itemCount} items, ${cacheCount} cached queries`
                    }
                })

                return items
            } catch (error: any) {
                return [
                    {
                        label: `Connection Error`,
                        name: 'error',
                        description: `Failed to connect to ERP: ${error.message}. Check that the ERP is running and the URL is correct.`
                    }
                ]
            }
        }
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const erpBaseUrl = ((nodeData.inputs?.erpBaseUrl as string) || DEFAULT_ERP_URL).replace(/\/+$/, '')
        const collectionId = nodeData.inputs?.collectionId as string
        const toolName = (nodeData.inputs?.toolName as string) || 'search_products'
        const toolDescription = (nodeData.inputs?.toolDescription as string) || 'Search for products in the ERP database.'

        if (!collectionId || collectionId === 'error') {
            throw new Error('Please select a valid RAG collection. Click the refresh button to load collections from the ERP.')
        }

        return new AppCityRAGTool({
            erpBaseUrl,
            collectionId,
            toolName,
            toolDescription
        })
    }
}

interface AppCityRAGToolConfig {
    erpBaseUrl: string
    collectionId: string
    toolName: string
    toolDescription: string
}

class AppCityRAGTool extends Tool {
    name: string
    description: string
    private erpBaseUrl: string
    private collectionId: string

    constructor(config: AppCityRAGToolConfig) {
        super()
        this.name = config.toolName
        this.description = config.toolDescription
        this.erpBaseUrl = config.erpBaseUrl
        this.collectionId = config.collectionId
    }

    async _call(query: string): Promise<string> {
        try {
            const url = `${this.erpBaseUrl}/api/rag/search`
            const body: any = {
                collectionId: this.collectionId,
                query: query.trim()
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })

            if (!response.ok) {
                const errorText = await response.text()
                return `Error searching ERP: ${response.status} ${response.statusText}. ${errorText}`
            }

            const result = (await response.json()) as any

            if (result.status !== 'ok') {
                return `ERP search error: ${result.message || 'Unknown error'}`
            }

            return this.formatResults(result, query)
        } catch (error: any) {
            return `Failed to connect to ERP at ${this.erpBaseUrl}: ${error.message}`
        }
    }

    private formatResults(result: any, query: string): string {
        // The ERP search API returns: { status, source, cached, answer, products, matchedItemIds, ... }
        // All fields are at the TOP LEVEL, not nested under "data"

        const answer = result.answer
        const products = (result.products as any[]) || []
        const source = result.source || 'unknown'

        // If no answer and no products, nothing was found
        if (!answer && products.length === 0) {
            return `No results found for: "${query}"`
        }

        let response = ''

        // Add the answer (present in all search layers)
        if (answer) {
            response += answer
        }

        // Add product details if available
        if (products.length > 0) {
            const productList = products
                .map((p: any, idx: number) => {
                    const itemData = p.data || p
                    const fields = Object.entries(itemData)
                        .filter(([key]) => !['id', 'embedding', 'searchText', 'collectionId'].includes(key))
                        .map(([key, value]) => `  ${key}: ${value}`)
                        .join('\n')
                    const scoreStr = p.score ? ` (match: ${(p.score * 100).toFixed(0)}%)` : ''
                    return `[${idx + 1}]${scoreStr}\n${fields}`
                })
                .join('\n\n')
            response += `\n\nProducts:\n${productList}`
        }

        // Add metadata
        response += `\n\n[Source: ${source}${result.cached ? ' (cached)' : ''}${result.searchTimeMs ? ` | ${result.searchTimeMs}ms` : ''}]`

        return response
    }
}

module.exports = { nodeClass: AppCityRAG_Tools }
