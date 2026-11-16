package hub

import "sort"

// Counts is how many messages were submitted and how they ended.
type Counts struct {
	Submitted int
	Delivered int
	Failed    int
}

// Stats is the totals and the same counts per channel. A message for a channel nobody
// registered counts in Total only.
type Stats struct {
	Total    Counts
	Channels map[string]Counts
}

func newStats() Stats {
	return Stats{Channels: map[string]Counts{}}
}

// Names returns the channel names in alphabetical order.
func (s Stats) Names() []string {
	names := make([]string, 0, len(s.Channels))
	for name := range s.Channels {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (s *Stats) track(name string) {
	if _, ok := s.Channels[name]; !ok {
		s.Channels[name] = Counts{}
	}
}

func (s *Stats) add(name string, delivered bool) {
	s.Total = bump(s.Total, delivered)
	if name == "" {
		return
	}
	s.Channels[name] = bump(s.Channels[name], delivered)
}

func (s Stats) clone() Stats {
	channels := make(map[string]Counts, len(s.Channels))
	for name, counts := range s.Channels {
		channels[name] = counts
	}
	return Stats{Total: s.Total, Channels: channels}
}

func bump(counts Counts, delivered bool) Counts {
	counts.Submitted++
	if delivered {
		counts.Delivered++
	} else {
		counts.Failed++
	}
	return counts
}
