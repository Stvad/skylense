// ==UserScript==
// @name         Bluesky URL Mention Sidebar
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Display a sidebar with all mentions of the current URL on Bluesky, togglable via Alt+X, with logging, disabled in iframes, drag-resizeable, closeable, updates on navigation without monkey-patching, hidden if no mentions.
//               ALSO if on a Bluesky profile page, show all that user's posts sorted by top.
// @match        *://*/*
// @exclude-match      *://localhost:*/*
// @exclude-match      *://127.0.0.1:*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @connect      public.api.bsky.app
// @resource     customCSS https://unpkg.com/bsky-react-post@0.1.7/index.esm.css
// @run-at       document-idle
// @license MIT
// ==/UserScript==

(async function () {
    'use strict'

    if (window.self !== window.top) {
        console.log('[Bluesky Sidebar]: Running in iframe, script disabled')
        return
    }

    // Dynamically import dependencies
    const [React, ReactDOM, htm, bskyReactPost] = await Promise.all([
        import('https://esm.sh/react@19'),
        import('https://esm.sh/react-dom@19/client'),  // Changed to client import
        import('https://esm.sh/htm@3.1.1'),
        import('https://esm.sh/bsky-react-post@0.1.7'),
    ])

    const html = htm.default.bind(React.default.createElement)
    const {EmbeddedPost: BskyPost} = bskyReactPost

    const css = GM_getResourceText("customCSS")
    GM_addStyle(css)
    // Rest of your styles remain the same
    GM_addStyle(`
        #bluesky-sidebar {
            position: fixed;
            top: 50px;
            right: 0;
            width: 450px;
            height: calc(100vh - 50px);
            background: #ffffff;
            border-left: 1px solid #e0e0e0;
            padding: 16px;
            overflow-y: auto;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            display: none;
            box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
            color: black; 
        }
        .bluesky-sidebar-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid #e0e0e0;
        }
        .bluesky-resize-handle {
            position: absolute;
            left: -3px;
            top: 0;
            width: 6px;
            height: 100%;
            cursor: ew-resize;
            background: transparent;
            z-index: 10001;
        }
        .bluesky-close-btn {
            background: transparent;
            border: none;
            font-size: 20px;
            cursor: pointer;
            padding: 4px 8px;
            color: #536471;
        }
        .bluesky-close-btn:hover {
            background: #f7f7f7;
            border-radius: 4px;
        }
        .bsky-react-post-theme {
            margin-top: 1em;
        }
        .bsky-react-post-theme a {
            text-decoration: none;
        }
    `)

    // Component definitions remain the same
    const Post = ({post}) => {
        return html`
            <${BskyPost} thread=${{post, parent: null, replies: []}}/>`
    }

    const Sidebar = ({posts, onClose, isLoading}) => {
        const [width, setWidth] = React.default.useState(450)
        const sidebarRef = React.default.useRef(null)

        React.default.useEffect(() => {
            if (sidebarRef.current) {
                sidebarRef.current.style.display = 'block'
                sidebarRef.current.style.width = `${width}px`
            }
        }, [width])

        const handleResizeStart = (e) => {
            const startX = e.clientX
            const startWidth = width

            const handleMouseMove = (e) => {
                const deltaX = startX - e.clientX
                const newWidth = Math.max(startWidth + deltaX, 150)
                setWidth(newWidth)
            }

            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
            }

            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return html`
            <div id="bluesky-sidebar" ref=${sidebarRef}>
                <div className="bluesky-resize-handle"
                     onMouseDown=${handleResizeStart}
                />
                <div className="bluesky-sidebar-header">
                    <h2>Bluesky Mentions</h2>
                    <button className="bluesky-close-btn" onClick=${onClose}>×</button>
                </div>
                ${isLoading ? html`<p>Loading...</p>` :
                        posts.length ? posts.map(post => html`
                                    <${Post} key=${post.uri} post=${post}/>`)
                                : html`<p>No mentions found.</p>`
                }
            </div>
        `
    }

    const getPosts = (data) => {
        if (!data?.posts) return []
        return data.posts.map(post =>
            ({
                ...post,
                author: {
                    ...post.author,
                    labels: post.author.labels?.filter(l => l.val !== "!no-unauthenticated"),
                },
            }))
    }

    const App = () => {
        const [posts, setPosts] = React.default.useState([])
        const [isLoading, setIsLoading] = React.default.useState(false)
        const [isVisible, setIsVisible] = React.default.useState(false)
        const lastUrl = React.default.useRef(window.location.href)

        const fetchMentions = React.default.useCallback(async () => {
            setIsLoading(true)
            const handle = extractProfileHandle()
            const query = handle ? `from:${handle}` : window.location.href
            const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&sort=top`

            try {
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: apiUrl,
                        headers: {'Accept': 'application/json'},
                        onload: resolve,
                        onerror: reject,
                    })
                })

                const data = JSON.parse(response.responseText)
                const newPosts = getPosts(data)
                setPosts(newPosts)
                if (newPosts.length > 0) {
                    setIsVisible(true)
                }
            } catch (error) {
                console.error('[Bluesky Sidebar]: Error fetching mentions:', error)
                setPosts([])
            } finally {
                setIsLoading(false)
            }
        }, [])

        React.default.useEffect(() => {
            fetchMentions()
        }, [])

        React.default.useEffect(() => {
            const handleKeyDown = (e) => {
                if (e.altKey && e.code === 'KeyX') {
                    setIsVisible(v => !v)
                }
            }

            const checkUrlChange = () => {
                if (window.location.href !== lastUrl.current) {
                    lastUrl.current = window.location.href
                    fetchMentions()
                }
            }

            document.addEventListener('keydown', handleKeyDown)
            window.addEventListener('popstate', checkUrlChange)
            const interval = setInterval(checkUrlChange, 1000)

            return () => {
                document.removeEventListener('keydown', handleKeyDown)
                window.removeEventListener('popstate', checkUrlChange)
                clearInterval(interval)
            }
        }, [fetchMentions, posts.length])

        if (!isVisible) return null

        return html`
            <${Sidebar}
                    posts=${posts}
                    isLoading=${isLoading}
                    onClose=${() => setIsVisible(false)}
            />
        `
    }

    function extractProfileHandle() {
        if (window.location.host !== 'bsky.app') return null
        const match = window.location.href.match(/\/profile\/([^/]+)$/)
        return match?.[1] ? decodeURIComponent(match[1]) : null
    }

    const root = document.createElement('div')
    root.id = 'bluesky-root'
    document.body.appendChild(root)
    const reactRoot = ReactDOM.default.createRoot(root)
    reactRoot.render(React.default.createElement(App))
})()
