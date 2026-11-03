/**
 * Expression evaluator for the built-in calculator.
 *
 * It is a small recursive-descent parser rather than `eval` or `new Function`:
 * the calculator accepts typed input, and running arbitrary JavaScript from a
 * text box would let a pasted expression reach the renderer's scope. The parser
 * only understands numbers, the arithmetic operators, parentheses, a dozen
 * named functions and two constants, so anything else is a syntax error.
 *
 * Grammar (lowest to highest precedence):
 *
 *   expression := term (('+' | '-') term)*
 *   term       := power (('*' | '/' | '%') power)*
 *   power      := unary ('^' power)?          // right associative
 *   unary      := ('+' | '-') unary | postfix
 *   postfix    := primary '!'?                // factorial
 *   primary    := number | constant | function '(' expression ')' | '(' expression ')'
 */

export type CalculatorFailure = 'invalid' | 'division-by-zero' | 'not-finite' | 'empty';

export class CalculatorError extends Error {
  readonly reason: CalculatorFailure;

  constructor(reason: CalculatorFailure) {
    super(reason);
    this.name = 'CalculatorError';
    this.reason = reason;
  }
}

const FUNCTIONS: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

/** The keypad sends real glyphs; the parser only knows ASCII operators. */
function normalize(input: string): string {
  return input.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.').trim();
}

class Parser {
  private index = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  parse(): number {
    if (!this.source) throw new CalculatorError('empty');
    const value = this.parseExpression();
    this.skipSpaces();
    if (this.index < this.source.length) throw new CalculatorError('invalid');
    return value;
  }

  private skipSpaces(): void {
    while (this.index < this.source.length && /\s/.test(this.source[this.index])) this.index += 1;
  }

  private peek(): string {
    this.skipSpaces();
    return this.source[this.index] || '';
  }

  private eat(char: string): boolean {
    this.skipSpaces();
    if (this.source[this.index] !== char) return false;
    this.index += 1;
    return true;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      const op = this.peek();
      if (op === '+') {
        this.index += 1;
        value += this.parseTerm();
      } else if (op === '-') {
        this.index += 1;
        value -= this.parseTerm();
      } else {
        return value;
      }
    }
  }

  private parseTerm(): number {
    let value = this.parsePower();
    for (;;) {
      const op = this.peek();
      if (op === '*') {
        this.index += 1;
        value *= this.parsePower();
      } else if (op === '/') {
        this.index += 1;
        const divisor = this.parsePower();
        if (divisor === 0) throw new CalculatorError('division-by-zero');
        value /= divisor;
      } else if (op === '%') {
        this.index += 1;
        const divisor = this.parsePower();
        if (divisor === 0) throw new CalculatorError('division-by-zero');
        value %= divisor;
      } else {
        return value;
      }
    }
  }

  private parsePower(): number {
    const base = this.parseUnary();
    if (this.eat('^')) return Math.pow(base, this.parsePower());
    return base;
  }

  private parseUnary(): number {
    const sign = this.peek();
    if (sign === '-') {
      this.index += 1;
      return -this.parseUnary();
    }
    if (sign === '+') {
      this.index += 1;
      return this.parseUnary();
    }
    return this.parsePostfix();
  }

  private parsePostfix(): number {
    const value = this.parsePrimary();
    if (this.eat('!')) return factorial(value);
    return value;
  }

  private parsePrimary(): number {
    if (this.eat('(')) {
      const value = this.parseExpression();
      if (!this.eat(')')) throw new CalculatorError('invalid');
      return value;
    }

    const start = this.index;
    if (/[0-9.]/.test(this.peek())) {
      while (this.index < this.source.length && /[0-9.]/.test(this.source[this.index])) this.index += 1;
      const text = this.source.slice(start, this.index);
      if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) throw new CalculatorError('invalid');
      return Number(text.endsWith('.') ? `${text}0` : text);
    }

    const nameStart = this.index;
    while (this.index < this.source.length && /[a-z]/i.test(this.source[this.index])) this.index += 1;
    const name = this.source.slice(nameStart, this.index).toLowerCase();
    if (!name) throw new CalculatorError('invalid');

    if (this.peek() === '(') {
      const fn = FUNCTIONS[name];
      if (!fn) throw new CalculatorError('invalid');
      this.index += 1;
      const argument = this.parseExpression();
      if (!this.eat(')')) throw new CalculatorError('invalid');
      return fn(argument);
    }

    if (name in CONSTANTS) return CONSTANTS[name];
    throw new CalculatorError('invalid');
  }
}

function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 170) throw new CalculatorError('invalid');
  let result = 1;
  for (let i = 2; i <= value; i += 1) result *= i;
  return result;
}

/**
 * Evaluates an arithmetic expression. Throws `CalculatorError` with a reason
 * the UI can translate, so a wrong keystroke never shows `NaN` or `Infinity`.
 */
export function evaluateExpression(input: string): number {
  const value = new Parser(normalize(input)).parse();
  if (!Number.isFinite(value)) throw new CalculatorError('not-finite');
  return value;
}

/** Same as `evaluateExpression` but null instead of throwing, for key previews. */
export function tryEvaluateExpression(input: string): number | null {
  try {
    return evaluateExpression(input);
  } catch {
    return null;
  }
}

/**
 * Renders a result the way a pocket calculator does: at most twelve significant
 * digits, no `0.30000000000000004`, and no exponent until the number is truly
 * long.
 */
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}
