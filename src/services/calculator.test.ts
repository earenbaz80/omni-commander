import { describe, it, expect } from 'vitest';
import { CalculatorError, evaluateExpression, formatResult, tryEvaluateExpression } from './calculator';

const failure = (input: string): string => {
  try {
    evaluateExpression(input);
    return 'no-throw';
  } catch (error) {
    return error instanceof CalculatorError ? error.reason : 'other';
  }
};

describe('calculator expression evaluator', () => {
  it('applies operator precedence', () => {
    expect(evaluateExpression('2+3*4')).toBe(14);
    expect(evaluateExpression('2*3+4')).toBe(10);
    expect(evaluateExpression('10-4/2')).toBe(8);
  });

  it('honours parentheses', () => {
    expect(evaluateExpression('(2+3)*4')).toBe(20);
    expect(evaluateExpression('2*(3+(4-1))')).toBe(12);
  });

  it('treats a leading sign as unary', () => {
    expect(evaluateExpression('-5+2')).toBe(-3);
    expect(evaluateExpression('-(2+3)')).toBe(-5);
    expect(evaluateExpression('3*-2')).toBe(-6);
    expect(evaluateExpression('--2')).toBe(2);
  });

  it('makes exponentiation right-associative and stronger than sign', () => {
    expect(evaluateExpression('2^3^2')).toBe(512);
    expect(evaluateExpression('2^3')).toBe(8);
    expect(evaluateExpression('2^-1')).toBe(0.5);
  });

  it('supports functions, constants and factorial', () => {
    expect(evaluateExpression('sqrt(16)')).toBe(4);
    expect(evaluateExpression('round(2.6)')).toBe(3);
    expect(evaluateExpression('5!')).toBe(120);
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI, 10);
    expect(evaluateExpression('e')).toBeCloseTo(Math.E, 10);
  });

  it('accepts the glyphs the keypad sends and comma decimals', () => {
    expect(evaluateExpression('6×7')).toBe(42);
    expect(evaluateExpression('9÷3')).toBe(3);
    expect(evaluateExpression('1,5+0,5')).toBe(2);
    expect(evaluateExpression('  7  %  4 ')).toBe(3);
  });

  it('rejects malformed input instead of returning NaN', () => {
    expect(failure('')).toBe('empty');
    expect(failure('2+')).toBe('invalid');
    expect(failure('(2+3')).toBe('invalid');
    expect(failure('2 3')).toBe('invalid');
    expect(failure('alert(1)')).toBe('invalid');
    expect(failure('5!5')).toBe('invalid');
  });

  it('reports division by zero and non-finite results', () => {
    expect(failure('1/0')).toBe('division-by-zero');
    expect(failure('5%0')).toBe('division-by-zero');
    expect(failure('sqrt(-1)')).toBe('not-finite');
  });

  it('offers a null-returning variant for live previews', () => {
    expect(tryEvaluateExpression('2*21')).toBe(42);
    expect(tryEvaluateExpression('2*')).toBeNull();
  });

  it('formats results without floating-point noise', () => {
    expect(formatResult(0.1 + 0.2)).toBe('0.3');
    expect(formatResult(42)).toBe('42');
    expect(formatResult(-1.5)).toBe('-1.5');
    expect(formatResult(Number.NaN)).toBe('—');
  });
});
