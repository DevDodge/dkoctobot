import { convertMultiOptionsToStringArray, getCredentialData, getCredentialParam } from '../../../src/utils'
import { createWhatsDeveloperTools } from './core'
import type { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'

class WhatsDeveloper_Tools implements INode {
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
        this.label = 'WhatsDeveloper'
        this.name = 'whatsDeveloperTool'
        this.version = 1.0
        this.type = 'WhatsDeveloper'
        this.icon = 'whatsdeveloper.svg'
        this.category = 'Tools'
        this.description = 'Send WhatsApp messages, check numbers, and manage labels via WhatsDeveloper API'
        this.baseClasses = ['Tool']
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['whatsDeveloperApi']
        }
        this.inputs = [
            {
                label: 'Type',
                name: 'actionType',
                type: 'options',
                description: 'Category of WhatsDeveloper operations',
                options: [
                    {
                        label: 'Messaging',
                        name: 'messaging'
                    },
                    {
                        label: 'Labels',
                        name: 'labels'
                    }
                ]
            },
            // Messaging Actions
            {
                label: 'Messaging Actions',
                name: 'messagingActions',
                type: 'multiOptions',
                description: 'Select which messaging actions to enable',
                options: [
                    {
                        label: 'Send Text Message',
                        name: 'sendText'
                    },
                    {
                        label: 'Send Image',
                        name: 'sendImage'
                    },
                    {
                        label: 'Send Document',
                        name: 'sendDocument'
                    },
                    {
                        label: 'Send Audio',
                        name: 'sendAudio'
                    },
                    {
                        label: 'Send Video',
                        name: 'sendVideo'
                    },
                    {
                        label: 'Send Location',
                        name: 'sendLocation'
                    },
                    {
                        label: 'Send Contact',
                        name: 'sendContact'
                    },
                    {
                        label: 'Check WhatsApp Number',
                        name: 'checkNumber'
                    }
                ],
                show: {
                    actionType: ['messaging']
                }
            },
            // Label Actions
            {
                label: 'Label Actions',
                name: 'labelActions',
                type: 'multiOptions',
                description: 'Select which label management actions to enable',
                options: [
                    {
                        label: 'Get All Labels',
                        name: 'getLabels'
                    },
                    {
                        label: 'Get Label by ID',
                        name: 'getLabelById'
                    },
                    {
                        label: 'Get Chats by Label',
                        name: 'getChatsByLabel'
                    },
                    {
                        label: 'Get Chat Labels',
                        name: 'getChatLabels'
                    },
                    {
                        label: 'Assign Labels to Chats',
                        name: 'assignLabels'
                    },
                    {
                        label: 'Remove Labels from Chats',
                        name: 'removeLabels'
                    },
                    {
                        label: 'Set (Replace) Chat Labels',
                        name: 'setChatLabels'
                    }
                ],
                show: {
                    actionType: ['labels']
                }
            },
            // Recipients Override
            {
                label: 'Recipients Override',
                name: 'recipients',
                type: 'string',
                description:
                    'If set, this overrides the recipient phone number(s) from the AI agent. Comma-separated for multiple. Leave empty to let the AI agent decide.',
                placeholder: 'e.g., 201234567890 or 201234567890,201098765432',
                optional: true,
                additionalParams: true,
                show: {
                    actionType: ['messaging']
                }
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const actionType = nodeData.inputs?.actionType as string

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const deviceUuid = getCredentialParam('deviceUuid', credentialData, nodeData)
        const apiToken = getCredentialParam('apiToken', credentialData, nodeData)

        if (!deviceUuid) {
            throw new Error('Device UUID is required in credential')
        }
        if (!apiToken) {
            throw new Error('API Token is required in credential')
        }

        // Get selected actions based on type
        let actions: string[] = []

        if (actionType === 'messaging') {
            actions = convertMultiOptionsToStringArray(nodeData.inputs?.messagingActions)
        } else if (actionType === 'labels') {
            actions = convertMultiOptionsToStringArray(nodeData.inputs?.labelActions)
        }

        const defaultRecipients = (nodeData.inputs?.recipients as string) || ''

        const tools = createWhatsDeveloperTools({
            actions,
            deviceUuid,
            apiToken,
            defaultRecipients
        })

        return tools
    }
}

module.exports = { nodeClass: WhatsDeveloper_Tools }
