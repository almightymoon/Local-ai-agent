class AudioBuffer:
    def __init__(self):
        self.chunks = []

    def push(self, chunk: bytes):
        self.chunks.append(chunk)

    def read(self) -> bytes:
        return b"".join(self.chunks)

    def clear(self):
        self.chunks = []
