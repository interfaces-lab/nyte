package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const lockName = "nyte-tailnet.lock"

type lockHolder struct {
	PID      int    `json:"pid"`
	Instance string `json:"instance"`
}

type lockedError struct {
	path   string
	holder int
}

func (e *lockedError) Error() string {
	return fmt.Sprintf("nyte-tailnet %d already runs the node in %s", e.holder, filepath.Dir(e.path))
}

func lockState(dir string) (*os.File, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}

	path := filepath.Join(dir, lockName)
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}

	acquired, err := tryLock(file)
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("locking %s: %w", path, err)
	}

	if !acquired {
		defer file.Close()

		var held lockHolder
		data, _ := io.ReadAll(io.LimitReader(file, 4096))
		json.Unmarshal(data, &held)

		return nil, &lockedError{path: path, holder: held.PID}
	}

	data, err := json.Marshal(lockHolder{PID: os.Getpid(), Instance: rand.Text()})
	if err != nil {
		file.Close()
		return nil, err
	}

	if err := file.Truncate(0); err != nil {
		file.Close()
		return nil, err
	}

	if _, err := file.WriteAt(append(data, '\n'), 0); err != nil {
		file.Close()
		return nil, err
	}

	return file, nil
}
