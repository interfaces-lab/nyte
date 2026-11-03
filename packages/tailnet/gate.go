package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"
	"sync/atomic"

	"tailscale.com/client/local"
	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
)

const principalHeader = "X-Nyte-Tailnet-Principal"

type principal struct {
	Kind      string   `json:"kind"`
	UserID    string   `json:"userId"`
	LoginName string   `json:"loginName"`
	Node      string   `json:"node"`
	Tags      []string `json:"tags"`
}

type owner struct {
	user   tailcfg.UserID
	tagged bool
}

type caller struct {
	who *apitype.WhoIsResponse
	err error
}

type callerKey struct{}

type principalKey struct{}

type gate struct {
	client *local.Client
	access string
	owner  atomic.Pointer[owner]
	proxy  *httputil.ReverseProxy
}

func newGate(client *local.Client, opts options) *gate {
	socket := opts.socket
	dialer := &net.Dialer{}

	return &gate{
		client: client,
		access: opts.access,
		proxy: &httputil.ReverseProxy{
			Rewrite: func(request *httputil.ProxyRequest) {
				request.SetXForwarded()
				request.Out.URL.Scheme = "http"
				request.Out.URL.Host = "nyte-host"
				request.Out.Host = request.In.Host
				request.Out.Header.Del(principalHeader)
				if encoded, ok := request.In.Context().Value(principalKey{}).(string); ok {
					request.Out.Header.Set(principalHeader, encoded)
				}
			},
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					return dialer.DialContext(ctx, "unix", socket)
				},
			},
			FlushInterval: -1,
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
				log.Printf("proxying to the host: %v", err)
				writeError(w, http.StatusBadGateway, "unavailable", "The Nyte host is not answering.")
			},
		},
	}
}

func (g *gate) observe(st *ipnstate.Status) {
	if st.Self == nil {
		return
	}

	g.owner.Store(&owner{user: st.Self.UserID, tagged: st.Self.IsTagged()})
}

func (g *gate) connContext(ctx context.Context, conn net.Conn) context.Context {
	who, err := g.client.WhoIs(ctx, conn.RemoteAddr().String())

	return context.WithValue(ctx, callerKey{}, caller{who: who, err: err})
}

func (g *gate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	found, _ := r.Context().Value(callerKey{}).(caller)

	if found.err != nil || found.who == nil || found.who.Node == nil || found.who.UserProfile == nil {
		writeError(w, http.StatusForbidden, "denied", "This host can't tell who is calling.")
		return
	}

	if !g.admits(found.who) {
		writeError(w, http.StatusForbidden, "denied", "Only the Tailscale user who owns this host may connect.")
		return
	}

	encoded, err := encodePrincipal(found.who)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "This host can't describe the caller.")
		return
	}

	g.proxy.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, encoded)))
}

func (g *gate) admits(who *apitype.WhoIsResponse) bool {
	if g.access == "tailnet" {
		return true
	}

	self := g.owner.Load()

	return self != nil && !self.tagged && !who.Node.IsTagged() && who.Node.User == self.user
}

func describe(who *apitype.WhoIsResponse) principal {
	tags := who.Node.Tags
	if tags == nil {
		tags = []string{}
	}

	return principal{
		Kind:      "tailscale",
		UserID:    strconv.FormatInt(int64(who.UserProfile.ID), 10),
		LoginName: who.UserProfile.LoginName,
		Node:      string(who.Node.StableID),
		Tags:      tags,
	}
}

func encodePrincipal(who *apitype.WhoIsResponse) (string, error) {
	data, err := json.Marshal(describe(who))
	if err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(data), nil
}

func writeError(w http.ResponseWriter, code int, kind, message string) {
	body, _ := json.Marshal(map[string]string{"code": kind, "message": message})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(body)
}
