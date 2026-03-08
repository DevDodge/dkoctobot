import { INodeParams, INodeCredential } from '../src/Interface'

class WhatsDeveloperApi implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'WhatsDeveloper API'
        this.name = 'whatsDeveloperApi'
        this.version = 1.0
        this.description = 'WhatsDeveloper WhatsApp API credentials'
        this.inputs = [
            {
                label: 'Device UUID',
                name: 'deviceUuid',
                type: 'password',
                description: 'Your device unique identifier (X-Device-UUID)',
                placeholder: 'e.g., 11666fa0-2cbb-4b1f-b6ba-29b63fd7ed51'
            },
            {
                label: 'API Token',
                name: 'apiToken',
                type: 'password',
                description: 'Your API authentication token (X-API-Token)',
                placeholder: 'Enter your API token'
            }
        ]
    }
}

module.exports = { credClass: WhatsDeveloperApi }
