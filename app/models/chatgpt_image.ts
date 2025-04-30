import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ChatgptImage extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'user_id' })
  declare userId: number

  @column()
  declare model: string

  @column()
  declare prompt: string

  @column()
  declare output: string | null

  @column({ columnName: 'is_done' })
  declare isDone: boolean

  @column()
  declare error: boolean

  @column()
  declare size: string

  @column()
  declare quality: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
