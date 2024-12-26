// ==UserScript==
// @name         Bluesky URL Mention Sidebar
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Display a sidebar with all mentions of the current URL on Bluesky, togglable via Alt+X, with logging, disabled in iframes, drag-resizeable, closeable, updates on navigation without monkey-patching, hidden if no mentions.
//               ALSO if on a Bluesky profile page, show all that user's posts sorted by top.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      public.api.bsky.app
// ==/UserScript==

(function () {
    'use strict'

    // Check if in iframe; if so, do not run
    if (window.self !== window.top) {
        console.log('[Bluesky Sidebar]: Running in iframe, script disabled')
        return
    }

    console.log('[Bluesky Sidebar]: Script initialized at top-level window')

    let isResizing = false
    let startX = 0
    let startWidth = 450 // default width
    let sidebar = null
    let lastUrl = window.location.href

    // Add global keydown listener for Alt+X to toggle the sidebar
    document.addEventListener('keydown', (e) => {
        // Check for Alt+X
        if (e.altKey && e.code === 'KeyX') {
            if (sidebar) {
                if (sidebar.style.display === 'none') {
                    console.log('[Bluesky Sidebar]: Alt+X pressed, opening sidebar')
                    fetchMentions(sidebar)
                } else {
                    console.log('[Bluesky Sidebar]: Alt+X pressed, closing sidebar')
                    sidebar.style.display = 'none'
                }
            }
        }
    })

    function createSidebar() {
        console.log('[Bluesky Sidebar]: Attempting to create sidebar')
        // Check if the sidebar already exists
        if (document.getElementById('bluesky-sidebar')) {
            console.log('[Bluesky Sidebar]: Sidebar already exists. Skipping creation.')
            sidebar = document.getElementById('bluesky-sidebar')
            return
        }

        // Create sidebar element
        sidebar = document.createElement('div')
        sidebar.id = 'bluesky-sidebar'
        sidebar.innerHTML = `
            <div id="bluesky-sidebar-header">
                <h2>Bluesky Mentions</h2>
                <button id="bluesky-close-btn">X</button>
            </div>
            <p>Loading...</p>
        `
        document.body.appendChild(sidebar)

        // Create resize handle
        const resizeHandle = document.createElement('div')
        resizeHandle.id = 'bluesky-resize-handle'
        sidebar.appendChild(resizeHandle)

        console.log('[Bluesky Sidebar]: Sidebar created and appended to body')

        GM_addStyle(`
            #bluesky-sidebar {
                position: fixed;
                top: 50px;
                right: 0;
                width: ${startWidth}px;
                height: 100%;
                background: #f0f0f0;
                border-left: 1px solid #ccc;
                padding: 10px;
                overflow-y: auto;
                z-index: 10000;
                font-family: sans-serif;
                box-sizing: border-box;
                display: none; /* Initially hidden until we know if mentions exist */
            }
            #bluesky-sidebar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            #bluesky-sidebar-header h2 {
                font-size: 18px;
                margin: 0;
            }
            #bluesky-sidebar p {
                font-size: 14px;
            }
            #bluesky-sidebar blockquote {
                border-left: 2px solid #ccc;
                margin: 10px 0;
                padding-left: 10px;
                background: #fff;
                font-size: 14px;
                line-height: 1.4;
            }
            #bluesky-close-btn {
                background: transparent;
                border: none;
                font-size: 16px;
                cursor: pointer;
                padding: 0 5px;
            }
            #bluesky-close-btn:hover {
                background: #ddd;
            }
            #bluesky-resize-handle {
                position: absolute;
                left: -3px;
                top: 0;
                width: 5px;
                height: 100%;
                cursor: ew-resize;
                background: rgba(0,0,0,0);
                z-index: 10001;
            }
        `)

        console.log('[Bluesky Sidebar]: Styles applied')

        const closeBtn = document.getElementById('bluesky-close-btn')
        closeBtn.addEventListener('click', () => {
            console.log('[Bluesky Sidebar]: Close button clicked')
            sidebar.style.display = 'none'
        })

        const onMouseMove = (e) => {
            if (!isResizing) return
            const deltaX = startX - e.clientX
            const newWidth = startWidth + deltaX
            sidebar.style.width = Math.max(newWidth, 150) + 'px'
        }

        const onMouseUp = (e) => {
            if (isResizing) {
                isResizing = false
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                startWidth = parseInt(sidebar.style.width, 10)
                console.log('[Bluesky Sidebar]: Resizing ended, final width:', startWidth + 'px')
            }
        }

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true
            startX = e.clientX
            startWidth = parseInt(window.getComputedStyle(sidebar).width, 10)
            console.log('[Bluesky Sidebar]: Resizing started at X:', startX, 'Current width:', startWidth + 'px')
            document.addEventListener('mousemove', onMouseMove)
            document.addEventListener('mouseup', onMouseUp)
        })

        fetchMentions(sidebar)
    }

    /**
     * Extract the handle from a Bluesky profile URL (e.g. "alice.bsky.social" in
     * "https://bsky.app/profile/alice.bsky.social").
     */
    function extractProfileHandle() {
        if (window.location.host !== 'bsky.app') return null

        // if (!isBlueskyProfilePage()) return null;
        const match = window.location.href.match(/\/profile\/([^/]+)$/)
        if (match && match[1]) {
            // Some Bluesky profiles can have query strings or extra paths,
            // so let's just decode that part
            return decodeURIComponent(match[1])
        }
        return null
    }

    const getApiUrl = () => {
        // Decide which endpoint or query to do
        const handle = extractProfileHandle()
        if (handle) {
            // On a user profile page, show all from that user sorted by "top"
            // Using searchPosts with "sort=top" and query = 'from:handle'
            console.log('[Bluesky Sidebar]: On profile page, searching posts from user:', handle)
            return `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent('from:' + handle)}&sort=top`
        } else {
            // Original behavior: search for the current URL
            return `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(window.location.href)}&sort=top`
        }
    }

    /**
     * Fetch posts either by searching for the URL (default) or,
     * if on a Bluesky profile page, by searching for that handle sorted by top.
     */
    function fetchMentions(sidebar) {
        if (!sidebar) return
        console.log('[Bluesky Sidebar]: Fetching mentions for URL:', window.location.href)
        lastUrl = window.location.href
        const apiUrl = getApiUrl()

        console.log('[Bluesky Sidebar]: Using API URL', apiUrl)

        GM_xmlhttpRequest({
            method: 'GET',
            url: apiUrl,
            headers: {
                'Accept': 'application/json',
            },
            onload: function (response) {
                console.log('[Bluesky Sidebar]: API responded with status', response.status)
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText)
                        console.log('[Bluesky Sidebar]: Parsed JSON data:', data)
                        displayMentions(data, sidebar)
                    } catch (e) {
                        console.error('[Bluesky Sidebar]: Error parsing JSON:', e)
                        sidebar.innerHTML = '<h2>Bluesky Mentions</h2><p>Error parsing response.</p>'
                        sidebar.style.display = 'none'
                    }
                } else {
                    console.error('[Bluesky Sidebar]: Non-200 status returned:', response.status)
                    sidebar.innerHTML = '<h2>Bluesky Mentions</h2><p>Error fetching mentions.</p>'
                    sidebar.style.display = 'none'
                }
            },
            onerror: function () {
                console.error('[Bluesky Sidebar]: Error during GM_xmlhttpRequest')
                sidebar.innerHTML = '<h2>Bluesky Mentions</h2><p>Error fetching mentions.</p>'
                sidebar.style.display = 'none'
            },
        })
    }

    function displayMentions(data, sidebar) {
        console.log('[Bluesky Sidebar]: Displaying mentions')

        if (data.posts && data.posts.length > 0) {
            // Only display the sidebar if we have posts
            sidebar.style.display = 'block'

            // Rebuild the sidebar content (preserves close button, etc.)
            sidebar.innerHTML = `
                <div id="bluesky-sidebar-header">
                    <h2>Bluesky Mentions</h2>
                    <button id="bluesky-close-btn">X</button>
                </div>
            `

            const closeBtn = document.getElementById('bluesky-close-btn')
            closeBtn.addEventListener('click', () => {
                console.log('[Bluesky Sidebar]: Close button clicked')
                sidebar.style.display = 'none'
            })

            // Re-add the resize handle
            const resizeHandle = document.createElement('div')
            resizeHandle.id = 'bluesky-resize-handle'
            sidebar.appendChild(resizeHandle)

            let localIsResizing = false
            let localStartX = 0
            let localStartWidth = parseInt(window.getComputedStyle(sidebar).width, 10)

            const onMouseMove = (e) => {
                if (!localIsResizing) return
                const deltaX = localStartX - e.clientX
                const newWidth = localStartWidth + deltaX
                sidebar.style.width = Math.max(newWidth, 150) + 'px'
            }

            const onMouseUp = (e) => {
                if (localIsResizing) {
                    localIsResizing = false
                    document.removeEventListener('mousemove', onMouseMove)
                    document.removeEventListener('mouseup', onMouseUp)
                    localStartWidth = parseInt(sidebar.style.width, 10)
                    console.log('[Bluesky Sidebar]: Resizing ended, final width:', localStartWidth + 'px')
                }
            }

            resizeHandle.addEventListener('mousedown', (e) => {
                localIsResizing = true
                localStartX = e.clientX
                localStartWidth = parseInt(window.getComputedStyle(sidebar).width, 10)
                console.log('[Bluesky Sidebar]: Resizing started at X:', localStartX, 'Current width:', localStartWidth + 'px')
                document.addEventListener('mousemove', onMouseMove)
                document.addEventListener('mouseup', onMouseUp)
            })

            data.posts.forEach((post, index) => {
                console.log('[Bluesky Sidebar]: Processing post', index, post)
                const blockquote = document.createElement('blockquote')
                blockquote.className = 'bluesky-embed'
                blockquote.setAttribute('data-bluesky-uri', post.uri)
                blockquote.setAttribute('data-bluesky-cid', post.cid)

                const p = document.createElement('p')
                p.textContent = post.record.text || '[No Text]'
                blockquote.appendChild(p)

                sidebar.appendChild(blockquote)
            })

            // Load or refresh the official Bluesky embed script if needed
            const embedScriptSrc = "https://embed.bsky.app/static/embed.js"
            if (!document.querySelector(`script[src="${embedScriptSrc}"]`)) {
                console.log('[Bluesky Sidebar]: Embed script not found, adding it now')
                const script = document.createElement('script')
                script.async = true
                script.src = embedScriptSrc
                script.charset = "utf-8"
                document.body.appendChild(script)

                script.addEventListener('load', () => {
                    console.log('[Bluesky Sidebar]: Embed script loaded')
                })
                script.addEventListener('error', (e) => {
                    console.error('[Bluesky Sidebar]: Error loading embed script', e)
                })
            } else {
                console.log('[Bluesky Sidebar]: Embed script already present on page')
                window?.bluesky?.scan()
            }
        } else {
            console.log('[Bluesky Sidebar]: No posts found, hiding sidebar')
            sidebar.style.display = 'none'
        }
    }

    window.addEventListener('load', () => {
        console.log('[Bluesky Sidebar]: window load event fired')
        createSidebar()
    })

    window.addEventListener('popstate', () => {
        console.log('[Bluesky Sidebar]: popstate event detected')
        if (sidebar) fetchMentions(sidebar)
    })

    window.addEventListener('hashchange', () => {
        console.log('[Bluesky Sidebar]: hashchange event detected')
        if (sidebar) fetchMentions(sidebar)
    })

    // Poll for URL changes in single-page apps
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            console.log('[Bluesky Sidebar]: URL changed detected by polling')
            if (sidebar && sidebar.style.display !== 'none') {
                fetchMentions(sidebar)
            } else {
                lastUrl = window.location.href
            }
        }
    }, 1000)

})()
