const instances = {
  stdout: { write: (_data: string) => {} },
  stdin: { ref: () => {}, unref: () => {} },
}

export default instances