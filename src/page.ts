import { unsafeWindow } from 'vite-plugin-monkey/dist/client'
import { getBase64FromImg } from './utils/dom'

declare global {
    interface Window {
        __reactRouterContext: {
            basename: string
            future: {}
            state: {
                loaderData: {
                    root: {
                        clientBootstrap: {
                            accountStatus: null
                            session: {
                                accessToken: string
                                authProvider: string
                                expires: string
                                user: {
                                    email: string
                                    group: unknown[]
                                    id: string
                                    image: string
                                    intercom_hash: string
                                    mfa: boolean
                                    name: string
                                    picture: string
                                }
                            }
                        }
                    }
                    'routes/share.$shareId.($action)': {
                        serverResponse: {
                            type: 'data'
                            data: any // Basically ApiConversation
                        }
                    }
                }
            }
        }
    }
}

export function getChatIdFromUrl() {
    // /share/1e5sf-asdf-1234
    // /c/1e5sf-asdf-1234
    // /g/1e5sf-asdf-1234/c/1e5sf-asdf-1234
    // /g/1e5sf-asdf-1234/shared/c/1e5sf-asdf-1234?owner_user_id=user-1234
    const match = location.pathname.match(/^\/(?:share|c|g\/[a-z0-9-]+\/(?:shared\/)?c)\/([a-z0-9-]+)/i)
    if (match) return match[1]
    return null
}

/**
 * A project member sees another member's conversation under a dedicated
 * `shared/c` route. ChatGPT requires the owner's user id when that
 * conversation is fetched through the conversation API.
 */
export function getConversationOwnerUserIdFromUrl(chatId: string) {
    if (!isSharedProjectConversationPage()) return null
    if (getChatIdFromUrl() !== chatId) return null

    const ownerUserId = new URLSearchParams(location.search).get('owner_user_id')?.trim()
    return ownerUserId || null
}

export function isSharedProjectConversationPage() {
    return /^\/g\/[a-z0-9-]+\/shared\/c\/[a-z0-9-]+/i.test(location.pathname)
}

export interface SharedProjectConversationLink {
    id: string
    ownerUserId: string | null
    title: string
}

export function getProjectIdFromUrl() {
    const match = location.pathname.match(/^\/g\/([a-z0-9-]+)\/(?:project|(?:shared\/)?c\/)/i)
    return match?.[1] || null
}

export function getProjectNameFromPage() {
    const heading = document.querySelector<HTMLElement>('main h1')
    return heading?.innerText.trim() || getProjectIdFromUrl() || 'Shared project'
}

function collectSharedProjectConversationLinks(projectId: string): SharedProjectConversationLink[] {
    const result = new Map<string, SharedProjectConversationLink>()
    const selector = `a[href*="/g/${projectId}/shared/c/"], a[href*="/g/${projectId}/c/"]`

    const anchors = Array.from(document.querySelectorAll(selector)) as HTMLAnchorElement[]
    for (const anchor of anchors) {
        const url = new URL(anchor.href, location.origin)
        const match = url.pathname.match(/^\/g\/[a-z0-9-]+\/(?:shared\/)?c\/([a-z0-9-]+)/i)
        if (!match) continue

        const id = match[1]
        const ownerUserId = url.pathname.includes('/shared/c/')
            ? url.searchParams.get('owner_user_id')?.trim() || null
            : null
        const textLines = anchor.innerText.split(/\n+/).map(line => line.trim()).filter(Boolean)
        const titleElement = anchor.querySelector('h1, h2, h3, [data-testid*="title"]') as HTMLElement | null
        const title = anchor.getAttribute('aria-label')?.trim()
            || titleElement?.innerText.trim()
            || textLines[1]
            || textLines[0]
            || id

        result.set(id, { id, ownerUserId, title })
    }

    return [...result.values()]
}

function findLoadMoreProjectConversationsButton() {
    const tabPanel = document.querySelector('[role="tabpanel"]')
    const root = tabPanel || document.querySelector('main') || document
    const pattern = /load more (?:conversations|chats)|加载更多(?:对话|聊天)|載入更多(?:對話|聊天)|さらに.*(?:会話|チャット)|cargar más|charger plus|daha fazla/i

    const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]
    return buttons
        .find(button => pattern.test(`${button.innerText} ${button.getAttribute('aria-label') || ''}`))
}

async function waitForProjectConversationListChange(projectId: string, previousCount: number, previousButton: HTMLButtonElement) {
    for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const currentCount = collectSharedProjectConversationLinks(projectId).length
        if (!previousButton.isConnected) return true
        if (currentCount > previousCount && !previousButton.disabled) return true
    }

    return collectSharedProjectConversationLinks(projectId).length > previousCount
}

async function activateProjectChatsTab(projectId: string) {
    if (collectSharedProjectConversationLinks(projectId).length > 0) return

    const pattern = /^(?:chats?|聊天|對話|チャット)$/i
    const tabs = Array.from(document.querySelectorAll('[role="tab"]')) as HTMLElement[]
    const chatsTab = tabs
        .find(tab => pattern.test(tab.innerText.trim()))
    if (!chatsTab || chatsTab.getAttribute('aria-selected') === 'true') return

    chatsTab.click()
    for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        if (collectSharedProjectConversationLinks(projectId).length > 0) return
    }
}

/** Expands the project page and returns the owner id required for every shared chat. */
export async function getSharedProjectConversationLinks(projectId: string) {
    if (getProjectIdFromUrl() !== projectId || !location.pathname.includes('/project')) return []

    await activateProjectChatsTab(projectId)

    for (let page = 0; page < 100; page++) {
        const button = findLoadMoreProjectConversationsButton()
        if (!button || button.disabled) break

        const previousCount = collectSharedProjectConversationLinks(projectId).length
        button.click()
        const changed = await waitForProjectConversationListChange(projectId, previousCount, button)
        if (!changed) break
    }

    return collectSharedProjectConversationLinks(projectId)
}

/**
 * Temporary chats are hidden from the history list and their id never reaches
 * the URL, although the conversation API still serves them once the id is
 * known (see temporaryChat.ts). Without this check the exporter falls through
 * to the most recent conversation in the history and silently exports the
 * wrong chat.
 */
export function isTemporaryChat() {
    return new URLSearchParams(location.search).get('temporary-chat') === 'true'
}

export function isSharePage() {
    return location.pathname.startsWith('/share')
        && !location.pathname.endsWith('/continue')
}

export function getConversationFromSharePage() {
    if (unsafeWindow.__reactRouterContext?.state?.loaderData?.['routes/share.$shareId.($action)']?.serverResponse?.data) {
        return JSON.parse(JSON.stringify(unsafeWindow.__reactRouterContext.state.loaderData['routes/share.$shareId.($action)'].serverResponse.data))
    }
    return null
}

const defaultAvatar = 'data:image/svg+xml,%3Csvg%20stroke%3D%22currentColor%22%20fill%3D%22none%22%20stroke-width%3D%221.5%22%20viewBox%3D%22-6%20-6%2036%2036%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20style%3D%22color%3A%20white%3B%20background%3A%20%23ab68ff%3B%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M20%2021v-2a4%204%200%200%200-4-4H8a4%204%200%200%200-4%204v2%22%3E%3C%2Fpath%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%227%22%20r%3D%224%22%3E%3C%2Fcircle%3E%3C%2Fsvg%3E'
export async function getUserAvatar(): Promise<string> {
    try {
        const avatars = Array.from(document.querySelectorAll<HTMLImageElement>('img[alt]:not([aria-hidden])'))
        const avatar = avatars.find(avatar => avatar.src.startsWith('https://cdn.auth0.com/avatars/'))
        if (avatar) return getBase64FromImg(avatar)
    }
    catch (e) {
        console.error(e)
    }

    return defaultAvatar
}

export function checkIfConversationStarted() {
    return !!document.querySelector('[data-testid^="conversation-turn-"]')
}
