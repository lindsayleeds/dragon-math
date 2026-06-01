async (page) => {
  const solveGame = async () => {
    let problemsSolved = 0;
    
    while (problemsSolved < 12) {
      // Wait a bit for the problem to render
      await page.waitForTimeout(200);
      
      // Get the current problem text
      const problemText = await page.evaluate(() => {
        const elements = document.querySelectorAll('*');
        for (let el of elements) {
          const text = el.textContent;
          if (text && text.match(/\d+\s*[×÷+−-]\s*\d+/)) {
            const match = text.match(/(\d+)\s*[×÷+−-]\s*(\d+)/);
            if (match && text.length < 50) {
              return text;
            }
          }
        }
        return null;
      });
      
      if (!problemText) break;
      
      // Parse the problem
      const parts = problemText.match(/(\d+)\s*[×÷+−-]\s*(\d+)/);
      if (!parts) break;
      
      const num1 = parseInt(parts[1]);
      const num2 = parseInt(parts[2]);
      let correctAnswer;
      
      // Determine the operation
      if (problemText.includes('×')) {
        correctAnswer = num1 * num2;
      } else if (problemText.includes('÷')) {
        correctAnswer = Math.floor(num1 / num2);
      } else if (problemText.includes('+')) {
        correctAnswer = num1 + num2;
      } else {
        correctAnswer = Math.max(0, num1 - num2);
      }
      
      // Find and click the correct answer button
      const buttons = await page.$$('button');
      let found = false;
      
      for (const button of buttons) {
        const text = await button.textContent();
        if (text && text.trim() === String(correctAnswer)) {
          await button.click();
          found = true;
          break;
        }
      }
      
      if (!found) break;
      problemsSolved++;
    }
    
    return { solved: problemsSolved };
  };
  
  return await solveGame();
}
