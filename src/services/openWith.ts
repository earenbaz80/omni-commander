/**
 * One program Windows has registered for a file's extension.
 *
 * `id` is the absolute path of the executable itself, not the command line the
 * registry stores: the server parses that template and runs the program with the
 * file as one argument, so nothing here is ever handed to a shell.
 */
export interface OpenWithProgram {
  id: string;
  name: string;
}
