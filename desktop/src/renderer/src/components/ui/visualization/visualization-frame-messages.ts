type Receiver = (event: MessageEvent) => void
type Router = { receivers: Map<MessageEventSource, Receiver>; dispatch: Receiver }
const routers = new WeakMap<Window, Router>()

/** Route an opaque frame's messages once, rather than invoking every mounted
 * preview's listener for each height/wheel/ready notification. */
export function subscribeVisualizationFrameMessages(view: Window, source: Window, receive: Receiver): () => void {
    let router = routers.get(view)
    if (!router) {
        const receivers = new Map<MessageEventSource, Receiver>()
        const dispatch: Receiver = event => {
            if (event.origin !== 'null' || !event.source) return
            receivers.get(event.source)?.(event)
        }
        router = { receivers, dispatch }
        routers.set(view, router)
        view.addEventListener('message', dispatch)
    }
    const ownedRouter = router
    ownedRouter.receivers.set(source, receive)
    return () => {
        // StrictMode/source replacement may already have registered a newer owner.
        if (ownedRouter.receivers.get(source) !== receive) return
        ownedRouter.receivers.delete(source)
        if (ownedRouter.receivers.size === 0) {
            view.removeEventListener('message', ownedRouter.dispatch)
            if (routers.get(view) === ownedRouter) routers.delete(view)
        }
    }
}
