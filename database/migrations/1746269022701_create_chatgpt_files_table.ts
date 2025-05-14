import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chatgpt_files'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.integer('message_id').unsigned().nullable()
      table.string('url').notNullable()
      table.bigInteger('size').nullable()
      table.enum('type', ['image', 'file'])
      table.timestamp('expires_at', { useTz: false }).nullable()
      table.string('vector_store').nullable()
      table.boolean('is_ready').notNullable()
      table.boolean('is_expired').notNullable().defaultTo(false)
      table.timestamps()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
