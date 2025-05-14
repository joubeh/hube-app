import vine from '@vinejs/vine'

export const ChatgptfileUpload = vine.compile(
  vine.object({
    file: vine
      .file({
        size: 50 * 1024 * 1024,
        extnames: [
          'c',
          'cpp',
          'cs',
          'css',
          'doc',
          'docx',
          'go',
          'html',
          'java',
          'js',
          'json',
          'md',
          'pdf',
          'php',
          'pptx',
          'py',
          'rb',
          'sh',
          'tex',
          'ts',
          'txt',
        ],
      })
      .optional(),
    image: vine
      .file({
        size: 19 * 1024 * 1024,
        extnames: ['png', 'jpeg', 'jpg', 'webp'],
      })
      .optional(),
  })
)
