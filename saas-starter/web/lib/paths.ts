// This app is served under a base path (/account — next.config.ts). Next's router,
// <Link> and redirect() add it on their own; a URL built by hand (window.location, the
// SSO callbackURL, an invite link) must go through withBase().
//
// ?next= always holds an ABSOLUTE same-origin path, because it may point outside this
// app: deployed with your own frontend, "/" is that frontend and only /account/* is here.

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

// The template's API. Not derived from BASE_PATH: the gateway routes /account/api/* to the
// API service whatever this app's base path is, and leaves /api/* to the customer's backend.
export const API = '/account/api'

export const withBase = (path: string) => BASE_PATH + path

/** Where a signed-in visitor goes when there is no (valid) ?next=. */
export const HOME = withBase('/dashboard')

/** The ?next= target, if it is a same-site relative path (so it can't become an open redirect). */
export function safeNext(next: string | null, fallback = HOME): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback
}

/** The current page's ?next=, validated. */
export const nextParam = () => safeNext(new URLSearchParams(window.location.search).get('next'))

/** The current page as a ?next= value. */
export const here = (pathname: string) => encodeURIComponent(withBase(pathname) + window.location.search)

/**
 * Go to an absolute same-origin path: inside this app through the router, anywhere else
 * (your own frontend at "/") with a full page load.
 */
export function go(router: { replace(href: string): void }, target: string) {
  if (!BASE_PATH) return router.replace(target)
  if (target === BASE_PATH || target.startsWith(BASE_PATH + '/') || target.startsWith(BASE_PATH + '?')) {
    return router.replace(target.slice(BASE_PATH.length) || '/')
  }
  window.location.assign(target)
}
