import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ChatgptMessage extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'conversation_id' })
  declare conversationId: string

  @column()
  declare model: string

  @column()
  declare type: string

  @column()
  declare role: 'user' | 'assistant'

  @column()
  declare content: string

  @column({ columnName: 'tokens_count' })
  declare tokensCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
