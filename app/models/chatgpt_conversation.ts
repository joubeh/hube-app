import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate } from '@adonisjs/lucid/orm'
import { randomUUID } from 'crypto'

export default class ChatgptConversation extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column({ columnName: 'user_id' })
  declare userId: number

  @column()
  declare title: string

  @column({ columnName: 'is_hidden' })
  declare isHidden: boolean

  @column({ columnName: 'is_public' })
  declare isPublic: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @beforeCreate()
  static assignUuid(chatgptConversation: ChatgptConversation) {
    chatgptConversation.id = randomUUID()
  }
}
