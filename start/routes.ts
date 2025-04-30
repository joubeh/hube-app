import router from '@adonisjs/core/services/router'
import UserController from '#controllers/user_controller'
import ChatgptController from '#controllers/chatgpt_controller'

/* User */
router.post('/api/auth', [UserController, 'auth'])
router.post('/api/login', [UserController, 'login'])
router.post('/api/verify', [UserController, 'verify'])
router.post('/api/register', [UserController, 'register'])
router.post('/api/forgot-password', [UserController, 'forgotPassword'])
router.post('/api/reset-password', [UserController, 'resetPassword'])
router.post('/api/logout', [UserController, 'logout'])
router.get('/api/user', [UserController, 'user'])

/* Chatgpt */
router.post('/api/chatgpt/conversation/create', [ChatgptController, 'createConversation'])
router.post('/api/chatgpt/conversation/:id/message', [ChatgptController, 'messageConversation'])
router.post('/api/chatgpt/conversation/:id/share', [ChatgptController, 'shareConversation'])
router.post('/api/chatgpt/conversation/:id/delete', [ChatgptController, 'deleteConversation'])
router.get('/api/chatgpt/conversation/:id', [ChatgptController, 'conversation'])
router.get('/api/chatgpt/conversations', [ChatgptController, 'conversations'])
// router.post('/api/chatgpt/message/:id/update', [ChatgptController, 'updateMessage'])
router.post('/api/chatgpt/image', [ChatgptController, 'generateImage'])
router.get('/api/chatgpt/image/:id', [ChatgptController, 'image'])
