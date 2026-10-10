// Fixed-size FIFO ring buffer of short strings (telemetry messages held while offline).
// When full, pushing drops the oldest item. Plain C++ so it can be tested on the host.
#pragma once

#include <stddef.h>
#include <stdint.h>

class PerspiceBuffer {
 public:
  // `capacity` items of at most `itemBytes - 1` characters each; storage is allocated once.
  PerspiceBuffer(uint16_t capacity, uint16_t itemBytes);
  ~PerspiceBuffer();
  PerspiceBuffer(const PerspiceBuffer&) = delete;
  PerspiceBuffer& operator=(const PerspiceBuffer&) = delete;

  // Adds a message, dropping the oldest when full. Returns false if it does not fit a slot.
  bool push(const char* msg);
  // Copies the oldest message into `out`. Returns false when empty or `outBytes` is too small.
  bool peek(char* out, size_t outBytes) const { return peekAt(0, out, outBytes); }
  // Copies the message `index` positions after the oldest (0 = oldest).
  bool peekAt(uint16_t index, char* out, size_t outBytes) const;
  // Removes the oldest message. Returns false when empty.
  bool pop();

  uint16_t size() const { return count_; }
  uint16_t capacity() const { return capacity_; }
  bool empty() const { return count_ == 0; }
  // Number of messages discarded because the buffer was full.
  uint32_t dropped() const { return dropped_; }
  void clear() { head_ = count_ = 0; }

 private:
  char* slot(uint16_t index) const { return data_ + static_cast<size_t>(index) * itemBytes_; }

  char* data_;
  uint16_t capacity_;
  uint16_t itemBytes_;
  uint16_t head_ = 0;
  uint16_t count_ = 0;
  uint32_t dropped_ = 0;
};
