use std::collections::HashMap;

#[derive(Clone, Copy, Default)]
pub struct Counts {
    pub submitted: usize,
    pub delivered: usize,
    pub failed: usize,
}

#[derive(Clone)]
pub struct Stats {
    pub total: Counts,
    pub channels: HashMap<String, Counts>,
}

impl Stats {
    pub fn new() -> Self {
        Self {
            total: Counts::default(),
            channels: HashMap::new(),
        }
    }

    pub fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.channels.keys().cloned().collect();
        names.sort();
        names
    }

    pub fn track(&mut self, name: &str) {
        self.channels.entry(name.to_string()).or_default();
    }

    pub fn add(&mut self, name: &str, delivered: bool) {
        self.total = bump(self.total, delivered);
        if name.is_empty() {
            return;
        }
        let current = self.channels.get(name).copied().unwrap_or_default();
        self.channels.insert(name.to_string(), bump(current, delivered));
    }
}

fn bump(mut counts: Counts, delivered: bool) -> Counts {
    counts.submitted += 1;
    if delivered {
        counts.delivered += 1;
    } else {
        counts.failed += 1;
    }
    counts
}
