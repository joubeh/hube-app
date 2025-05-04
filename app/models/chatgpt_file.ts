import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ChatgptFile extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'user_id' })
  declare userId: number

  @column({ columnName: 'message_id' })
  declare messageId: number | null

  @column()
  declare url: string

  @column()
  declare size: number

  @column()
  declare type: 'image' | 'file'

  @column.dateTime({ columnName: 'expires_at', autoCreate: false, autoUpdate: false })
  declare expiresAt: DateTime | null

  @column({ columnName: 'vector_store' })
  declare vectorStore: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
