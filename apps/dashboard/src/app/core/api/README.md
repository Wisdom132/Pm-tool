# api

One file per resource, each a thin mapping of endpoint to method.

One service per resource, each a thin mapping of endpoint to method.
 *
Thin on purpose: no caching, no normalising, no shared store. A dashboard
page loads what it shows and reloads after it writes, which is correct by
construction and an order of magnitude less code than keeping a client
cache honest. If a screen ever needs more, it needs it for a reason that
will be obvious at the time.
