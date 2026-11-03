package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"slices"
	"sync"

	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
)

type status struct {
	State   string   `json:"state"`
	AuthURL string   `json:"authUrl,omitempty"`
	DNSName string   `json:"dnsName,omitempty"`
	HTTPS   string   `json:"https"`
	Access  string   `json:"access"`
	Tags    []string `json:"tags"`
}

type reporter struct {
	mu   sync.Mutex
	out  io.Writer
	now  status
	last []byte
}

func newReporter(out io.Writer, access string, tags []string) *reporter {
	report := &reporter{
		out: out,
		now: status{State: "starting", HTTPS: "pending", Access: access, Tags: slices.Clone(tags)},
	}

	if report.now.Tags == nil {
		report.now.Tags = []string{}
	}

	report.update(func(*status) {})

	return report
}

func (r *reporter) observe(st *ipnstate.Status) {
	r.update(func(now *status) {
		now.State = states[st.BackendState]
		if now.State == "" {
			now.State = "starting"
		}

		now.AuthURL = ""
		if now.State == "needs_login" {
			now.AuthURL = st.AuthURL
		}

		now.DNSName = dnsName(st)

		if st.BackendState == ipn.Running.String() && st.Self != nil {
			now.Tags = []string{}
			if st.Self.Tags != nil {
				now.Tags = st.Self.Tags.AsSlice()
			}
		}
	})
}

func (r *reporter) update(change func(now *status)) {
	r.mu.Lock()
	defer r.mu.Unlock()

	change(&r.now)

	line, err := json.Marshal(r.now)
	if err != nil {
		log.Printf("encoding status: %v", err)
		return
	}

	if bytes.Equal(line, r.last) {
		return
	}

	r.last = line

	if _, err := r.out.Write(append(line, '\n')); err != nil {
		log.Printf("writing status: %v", err)
	}
}
