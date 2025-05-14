import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import ChatgptFile from '#models/chatgpt_file'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import ChatgptConversation from '#models/chatgpt_conversation'

export default class ChatgptMessage extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'conversation_id' })
  declare conversationId: string

  @column()
  declare model: string

  @column()
  declare role: 'user' | 'assistant'

  @column()
  declare content: string

  @column({ columnName: 'tokens_count' })
  declare tokensCount: number

  @column({ columnName: 'response_id' })
  declare responseId: string | null

  @column({ columnName: 'use_web_search' })
  declare useWebSearch: boolean

  @column({ columnName: 'use_reasoning' })
  declare useReasoning: boolean

  @column({ columnName: 'reasoning_effort' })
  declare reasoningEffort: string | null

  @column({ columnName: 'image_size' })
  declare imageSize: string | null

  @column({ columnName: 'image_quality' })
  declare imageQuality: string | null

  @column({ columnName: 'is_done' })
  declare isDone: boolean

  @column()
  declare type: 'text' | 'image'

  @column({ columnName: 'parent_id' })
  declare parentId: number | null

  @column()
  declare audio: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => ChatgptFile, {
    foreignKey: 'messageId',
  })
  declare files: HasMany<typeof ChatgptFile>

  @belongsTo(() => ChatgptConversation, {
    foreignKey: 'conversationId',
  })
  declare conversation: BelongsTo<typeof ChatgptConversation>

  @belongsTo(() => ChatgptMessage, {
    foreignKey: 'parentId',
  })
  declare parent: BelongsTo<typeof ChatgptMessage>

  @hasMany(() => ChatgptMessage, {
    foreignKey: 'parentId',
  })
  declare children: HasMany<typeof ChatgptMessage>
}
