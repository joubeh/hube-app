import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chatgpt_messages'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .uuid('conversation_id')
        .references('id')
        .inTable('chatgpt_conversations')
        .onDelete('CASCADE')
      table.string('model').notNullable()
      table.string('type').notNullable()
      table.enum('role', ['user', 'assistant']).notNullable()
      table.text('content', 'longtext').notNullable()
      table.integer('tokens_count').notNullable()
      table.timestamps()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
