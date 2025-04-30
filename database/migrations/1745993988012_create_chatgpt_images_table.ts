import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chatgpt_images'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.string('model').notNullable()
      table.text('prompt').notNullable()
      table.string('output').nullable()
      table.boolean('is_done').defaultTo(false)
      table.boolean('error').defaultTo(false)
      table.string('size').notNullable()
      table.string('quality').notNullable()
      // table.string('price')
      table.timestamps()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
